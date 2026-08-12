import { describe, expect, it } from "vitest";
import { MAX_LINEAS, normalizarLineas } from "./cotizacion";

/**
 * `normalizarLineas` es la puerta de entrada de todo lo que manda el browser al
 * cotizador. Lo que pase de acá se convierte en llamadas a Alegra y termina en
 * un pedido, así que es el lugar donde se corta la basura.
 */

describe("normalizarLineas", () => {
  it("deja pasar líneas válidas", () => {
    expect(normalizarLineas([{ id: "a", qty: 2 }])).toEqual([{ id: "a", qty: 2 }]);
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
      { id: "a", qty: 2 },
      { id: "a", qty: 3 },
    ])).toEqual([{ id: "a", qty: 5 }]);
  });

  it("descarta cantidades no positivas o no numéricas", () => {
    expect(normalizarLineas([
      { id: "a", qty: 0 },
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
    expect(normalizarLineas([{ id: "a", qty: 2.9 }])).toEqual([{ id: "a", qty: 2 }]);
    // 0.5 baja a 0 y por lo tanto se descarta: no se puede pedir media unidad.
    expect(normalizarLineas([{ id: "a", qty: 0.5 }])).toEqual([]);
  });

  it("topea la cantidad por línea", () => {
    const [linea] = normalizarLineas([{ id: "a", qty: 999_999_999 }]);
    expect(linea.qty).toBeLessThanOrEqual(9_999);
  });

  it("topea la cantidad de líneas distintas", () => {
    const muchas = Array.from({ length: MAX_LINEAS + 40 }, (_, i) => ({
      id: `item-${i}`,
      qty: 1,
    }));
    expect(normalizarLineas(muchas)).toHaveLength(MAX_LINEAS);
  });

  it("acota el fan-out contra Alegra incluso con miles de líneas basura", () => {
    const ruido = Array.from({ length: 5_000 }, (_, i) => ({ id: `x-${i}`, qty: 1 }));
    expect(normalizarLineas(ruido).length).toBeLessThanOrEqual(MAX_LINEAS);
  });

  it("normaliza el id a string y le saca los espacios", () => {
    expect(normalizarLineas([{ id: "  a  ", qty: 1 }])).toEqual([{ id: "a", qty: 1 }]);
  });
});
