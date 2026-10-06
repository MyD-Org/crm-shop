import { describe, expect, it } from "vitest";
import { itemDesdeEspejo, MAX_LINEAS, normalizarLineas } from "./cotizacion";

/**
 * `normalizarLineas` es la puerta de entrada de todo lo que manda el browser al
 * cotizador. Lo que pase de acá se convierte en llamadas a Alegra y termina en
 * un pedido, así que es el lugar donde se corta la basura.
 */

describe("normalizarLineas", () => {
  it("deja pasar líneas válidas", () => {
    expect(normalizarLineas([{ id: "101", qty: 2 }])).toEqual([{ id: "101", qty: 2 }]);
  });

  it("devuelve vacío si no es un array", () => {
    for (const basura of [null, undefined, "abc", 42, {}]) {
      expect(normalizarLineas(basura)).toEqual([]);
    }
  });

  /**
   * Dos líneas del mismo id romperían la validación de stock: cada una pasaría
   * por separado contra el disponible, y entre las dos se llevarían más de lo
   * que hay.
   */
  it("suma las cantidades de un id repetido en una sola línea", () => {
    expect(normalizarLineas([
      { id: "101", qty: 2 },
      { id: "101", qty: 3 },
    ])).toEqual([{ id: "101", qty: 5 }]);
  });

  it("descarta cantidades no positivas o no numéricas", () => {
    expect(normalizarLineas([
      { id: "101", qty: 0 },
      { id: "b", qty: -5 },
      { id: "c", qty: NaN },
      { id: "d", qty: "muchas" },
      { id: "e", qty: Infinity },
    ])).toEqual([]);
  });

  it("descarta líneas sin id", () => {
    expect(normalizarLineas([
      { id: "", qty: 1 },
      { qty: 1 },
      { id: "   ", qty: 1 },
    ])).toEqual([]);
  });

  it("trunca los decimales hacia abajo", () => {
    expect(normalizarLineas([{ id: "101", qty: 2.9 }])).toEqual([{ id: "101", qty: 2 }]);
    // 0.5 baja a 0 y por lo tanto se descarta: no se puede pedir media unidad.
    expect(normalizarLineas([{ id: "101", qty: 0.5 }])).toEqual([]);
  });

  it("topea la cantidad por línea", () => {
    const [linea] = normalizarLineas([{ id: "101", qty: 999_999_999 }]);
    expect(linea.qty).toBeLessThanOrEqual(9_999);
  });

  it("topea la cantidad de líneas distintas", () => {
    const muchas = Array.from({ length: MAX_LINEAS + 40 }, (_, i) => ({
      id: `${1000 + i}`,
      qty: 1,
    }));
    expect(normalizarLineas(muchas)).toHaveLength(MAX_LINEAS);
  });

  it("acota el fan-out contra Alegra incluso con miles de líneas basura", () => {
    const ruido = Array.from({ length: 5_000 }, (_, i) => ({ id: `${i}`, qty: 1 }));
    expect(normalizarLineas(ruido).length).toBeLessThanOrEqual(MAX_LINEAS);
  });

  it("normaliza el id a string y le saca los espacios", () => {
    expect(normalizarLineas([{ id: "  101  ", qty: 1 }])).toEqual([{ id: "101", qty: 1 }]);
    expect(normalizarLineas([{ id: 101, qty: 1 }])).toEqual([{ id: "101", qty: 1 }]);
  });

  /**
   * El id termina en `/items/${id}` de Alegra. Con `"../contacts/123"` la URL
   * se resolvía a `/contacts/123` y la cotización devolvía la razón social de
   * cualquier cliente.
   */
  it("descarta ids que no son numéricos (path traversal a otros recursos)", () => {
    expect(normalizarLineas([
      { id: "../contacts/123", qty: 1 },
      { id: "..%2Fcontacts%2F123", qty: 1 },
      { id: "12/../../invoices/9", qty: 1 },
      { id: "12?x=1", qty: 1 },
      { id: "abc", qty: 1 },
      { id: "-5", qty: 1 },
      { id: "1.5", qty: 1 },
    ])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

import { cotizarItem } from "./cotizacion";
import { precioDeLista, type AlegraItem, type AlegraPrice } from "./alegra";

describe("cotizarItem y el stock de Alegra", () => {
  const item = (cantidad: number | null) =>
    ({
      id: "1",
      name: "Panel LED",
      status: "active",
      price: [{ idPriceList: "1", price: 1000, main: true }],
      inventory: cantidad === null ? undefined : { availableQuantity: cantidad },
    }) as unknown as AlegraItem;

  it("un ítem en cero queda sin stock", () => {
    const linea = cotizarItem({ id: "1", qty: 2 }, item(0), undefined);
    expect(linea.problema).toBe("sin_stock");
  });

  it("un ítem no inventariable se puede comprar", () => {
    const linea = cotizarItem({ id: "1", qty: 2 }, item(null), undefined);
    expect(linea.problema).toBeUndefined();
    expect(linea.stockDisponible).toBeNull();
  });

  it("con stock, informa la cantidad real", () => {
    const linea = cotizarItem({ id: "1", qty: 2 }, item(50), undefined);
    expect(linea.stockDisponible).toBe(50);
    expect(linea.problema).toBeUndefined();
  });
});

describe("cotizarItem: lista del medio de pago", () => {
  const item = (enMedio: number | null) =>
    ({
      id: "1",
      name: "Panel LED",
      status: "active",
      price: [
        { idPriceList: "1", price: 1000, main: true },
        { idPriceList: "7", price: 800, main: false },
        ...(enMedio === null ? [] : [{ idPriceList: "9", price: enMedio, main: false }]),
      ],
      inventory: { availableQuantity: 50 },
    }) as unknown as AlegraItem;

  it("aplica la lista del medio si el precio existe, es > 0 y menor que el general", () => {
    const l = cotizarItem({ id: "1", qty: 1 }, item(700), "9");
    expect(l.precioUnitario).toBe(700);
  });

  it("cae al general si el ítem no tiene precio en esa lista", () => {
    expect(cotizarItem({ id: "1", qty: 1 }, item(null), "9").precioUnitario).toBe(1000);
  });

  it("cae al general si el precio en la lista es 0 o no es menor (nunca recargo)", () => {
    expect(cotizarItem({ id: "1", qty: 1 }, item(0), "9").precioUnitario).toBe(1000);
    expect(cotizarItem({ id: "1", qty: 1 }, item(1000), "9").precioUnitario).toBe(1000);
    expect(cotizarItem({ id: "1", qty: 1 }, item(1300), "9").precioUnitario).toBe(1000);
  });

  it("coherencia con el catálogo: el unitario cotizado con el medio es precioDeLista de esa lista", () => {
    const it9 = item(700);
    const esperado = precioDeLista(it9.price as AlegraPrice[], "9");
    expect(cotizarItem({ id: "1", qty: 1 }, it9, "9").precioUnitario).toBe(esperado);
    const caro = item(1300);
    expect(cotizarItem({ id: "1", qty: 1 }, caro, "9").precioUnitario).toBe(
      precioDeLista(caro.price as AlegraPrice[], "9"),
    );
  });

});

describe("itemDesdeEspejo: mostrar marca", () => {
  const fila = {
    alegraId: "1",
    name: "Pantalla",
    code: null,
    brand: "Acme",
    prices: [],
    stock: null,
    ivaPorcentaje: null,
    status: "active",
    categoryName: "Iluminación",
  };

  it("con la marca apagada no viajan ni la marca ni la categoría de fallback", () => {
    const item = itemDesdeEspejo({ ...fila, mostrarMarca: false });
    expect(item.customFields).toBeUndefined();
    expect(item.itemCategory).toBeUndefined();
  });

  it("sin overlay la marca viaja como siempre", () => {
    expect(itemDesdeEspejo({ ...fila, mostrarMarca: null }).customFields).toEqual([{ name: "Marca", value: "Acme" }]);
  });
});

describe("cotizarItem con precios online (0065)", () => {
  const REF = "0f5d0c52-0000-4000-8000-00000000000a";
  const TRANSF = "0f5d0c52-0000-4000-8000-00000000000b";
  const CARA = "0f5d0c52-0000-4000-8000-00000000000c";
  const item = (price: unknown[]) =>
    ({ id: "1", name: "Panel LED", status: "active", price, inventory: { availableQuantity: 50 } }) as unknown as AlegraItem;
  const online = item([
    { idPriceList: REF, name: "Lista A", price: 120, main: true },
    { idPriceList: TRANSF, name: "Lista B", price: 110, main: false },
    { idPriceList: CARA, name: "Lista C", price: 190, main: false },
  ]);

  it("sin medio elegido rige la referencia (el precio principal)", () => {
    expect(cotizarItem({ id: "1", qty: 1 }, online, undefined).precioUnitario).toBe(120);
  });

  it("el medio con una lista menor cobra esa lista; con una mayor, la referencia", () => {
    expect(cotizarItem({ id: "1", qty: 1 }, online, TRANSF).precioUnitario).toBe(110);
    expect(cotizarItem({ id: "1", qty: 1 }, online, CARA).precioUnitario).toBe(120);
  });

  it("un producto sin precio online no se cotiza a $0: queda sin_precio", () => {
    const l = cotizarItem({ id: "1", qty: 1 }, item([]));
    expect(l.precioUnitario).toBe(0);
    expect(l.problema).toBe("sin_precio");
  });
});

describe("cotizarItem con lista privada (listas-cuenta-corriente)", () => {
  const MEDIO = "0f5d0c52-0000-4000-8000-00000000000b";
  const item = (price: unknown[] = [{ idPriceList: "1", price: 1000, main: true }]) =>
    ({ id: "1", name: "Panel LED", status: "active", price, inventory: { availableQuantity: 50 } }) as unknown as AlegraItem;

  it("cobra el precio privado neto y recalcula subtotal e IVA con él", () => {
    const l = cotizarItem({ id: "1", qty: 2 }, item(), undefined, 700);
    expect(l.precioUnitario).toBe(700);
    expect(l.subtotal).toBe(1400);
    expect(l.problema).toBeUndefined();
    expect(l.sinPrecio).toBeUndefined();
  });

  it("un precio privado MAYOR que el público se muestra igual (sin regla del 'menor que el general')", () => {
    const l = cotizarItem({ id: "1", qty: 1 }, item(), undefined, 1300);
    expect(l.precioUnitario).toBe(1300);
    expect(l.problema).toBeUndefined();
  });

  it("sin precio en la lista privada (null): sin_precio y NO cae al público", () => {
    const l = cotizarItem({ id: "1", qty: 1 }, item(), undefined, null);
    expect(l.precioUnitario).toBe(0);
    expect(l.problema).toBe("sin_precio");
    expect(l.sinPrecio).toBe(true);
    expect(l.detalle).toBe("Este producto no tiene precio para su cuenta. Consúltenos.");
  });

  it("ignora la lista del medio de pago (con lista privada no hay precio por medio)", () => {
    const conMedio = item([
      { idPriceList: "1", price: 1000, main: true },
      { idPriceList: MEDIO, price: 500, main: false },
    ]);
    expect(cotizarItem({ id: "1", qty: 1 }, conMedio, MEDIO, 900).precioUnitario).toBe(900);
    expect(cotizarItem({ id: "1", qty: 1 }, conMedio, MEDIO, null).problema).toBe("sin_precio");
  });

  it("sin lista privada (undefined) rige el comportamiento de siempre", () => {
    expect(cotizarItem({ id: "1", qty: 1 }, item(), undefined, undefined).precioUnitario).toBe(1000);
  });

  it("mantiene los problemas de stock e inactivo con precio privado", () => {
    const sinStock = { ...item(), inventory: { availableQuantity: 0 } } as unknown as AlegraItem;
    expect(cotizarItem({ id: "1", qty: 1 }, sinStock, undefined, 700).problema).toBe("sin_stock");
    const inactivo = { ...item(), status: "inactive" } as unknown as AlegraItem;
    expect(cotizarItem({ id: "1", qty: 1 }, inactivo, undefined, 700).problema).toBe("inactivo");
  });
});
