import { describe, expect, it } from "vitest";
import { MAX_LINEAS, normalizarLineas } from "./cotizacion";

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
import type { AlegraItem } from "./alegra";

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
