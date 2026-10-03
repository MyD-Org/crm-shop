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

describe("cotizarItem: precio efectivo de la cuenta", () => {
  const item = (propia: number) =>
    ({
      id: "1",
      name: "Panel LED",
      status: "active",
      price: [
        { idPriceList: "1", price: 1000, main: true },
        { idPriceList: "7", price: propia, main: false },
      ],
      inventory: { availableQuantity: 50 },
    }) as unknown as AlegraItem;

  it("propia más barata: cobra la propia y marca precio especial", () => {
    const l = cotizarItem({ id: "1", qty: 1 }, item(800), "7");
    expect(l.precioUnitario).toBe(800);
    expect(l.precioEspecial).toBe(true);
  });

  it("propia más cara: cobra la general, no el cliente paga más de lo que vio", () => {
    const l = cotizarItem({ id: "1", qty: 1 }, item(1200), "7");
    expect(l.precioUnitario).toBe(1000);
    expect(l.precioEspecial).toBeUndefined();
  });

  it("propia en 0: cobra la general y no queda sin_precio", () => {
    const l = cotizarItem({ id: "1", qty: 1 }, item(0), "7");
    expect(l.precioUnitario).toBe(1000);
    expect(l.problema).toBeUndefined();
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
    const l = cotizarItem({ id: "1", qty: 1 }, item(700), undefined, "9");
    expect(l.precioUnitario).toBe(700);
  });

  it("cae al general si el ítem no tiene precio en esa lista", () => {
    expect(cotizarItem({ id: "1", qty: 1 }, item(null), undefined, "9").precioUnitario).toBe(1000);
  });

  it("cae al general si el precio en la lista es 0 o no es menor (nunca recargo)", () => {
    expect(cotizarItem({ id: "1", qty: 1 }, item(0), undefined, "9").precioUnitario).toBe(1000);
    expect(cotizarItem({ id: "1", qty: 1 }, item(1000), undefined, "9").precioUnitario).toBe(1000);
    expect(cotizarItem({ id: "1", qty: 1 }, item(1300), undefined, "9").precioUnitario).toBe(1000);
  });

  it("coherencia con el catálogo: el unitario cotizado con el medio es precioDeLista de esa lista", () => {
    const it9 = item(700);
    const esperado = precioDeLista(it9.price as AlegraPrice[], "9");
    expect(cotizarItem({ id: "1", qty: 1 }, it9, undefined, "9").precioUnitario).toBe(esperado);
    const caro = item(1300);
    expect(cotizarItem({ id: "1", qty: 1 }, caro, undefined, "9").precioUnitario).toBe(
      precioDeLista(caro.price as AlegraPrice[], "9"),
    );
  });

  it("la lista del medio NO marca precio especial de la cuenta", () => {
    expect(cotizarItem({ id: "1", qty: 1 }, item(700), undefined, "9").precioEspecial).toBeUndefined();
  });

  it("con lista del medio, la lista propia del cliente no rige ni marca especial", () => {
    const l = cotizarItem({ id: "1", qty: 1 }, item(null), "7", "9");
    expect(l.precioUnitario).toBe(1000);
    expect(l.precioEspecial).toBeUndefined();
  });

  it("sin lista del medio conserva el comportamiento previo con la lista del cliente", () => {
    const l = cotizarItem({ id: "1", qty: 1 }, item(700), "7");
    expect(l.precioUnitario).toBe(800);
    expect(l.precioEspecial).toBe(true);
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
