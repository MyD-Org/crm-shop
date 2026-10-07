import { describe, expect, it } from "vitest";
import { cuotasFichaConCarrito, cuotasHastaFicha, lineasConProducto, metaCuotasFicha } from "./ficha-cuotas-carrito";
import { TEXTOS_CUOTAS } from "./cuotas-textos";

const sinNbsp = (s: string | undefined) => s?.replace(/[  ]/g, " ");

describe("lineasConProducto", () => {
  it("carrito vacío: null (no hay nada que cotizar)", () => {
    expect(lineasConProducto([], "10", 1)).toBeNull();
  });
  it("suma el producto como una línea más, sin tocar las del carrito", () => {
    const carrito = [{ id: "1", qty: 2 }];
    expect(lineasConProducto(carrito, "10", 3)).toEqual([
      { id: "1", qty: 2 },
      { id: "10", qty: 3 },
    ]);
    expect(carrito).toEqual([{ id: "1", qty: 2 }]);
  });
  it("si el producto ya está en el carrito, suma la cantidad", () => {
    expect(lineasConProducto([{ id: "10", qty: 2 }, { id: "1", qty: 1 }], "10", 1)).toEqual([
      { id: "10", qty: 3 },
      { id: "1", qty: 1 },
    ]);
  });
  it("cantidad inválida cuenta como 1", () => {
    expect(lineasConProducto([{ id: "1", qty: 1 }], "10", 0)).toEqual([{ id: "1", qty: 1 }, { id: "10", qty: 1 }]);
    expect(lineasConProducto([{ id: "1", qty: 1 }], "10", Number.NaN)).toEqual([{ id: "1", qty: 1 }, { id: "10", qty: 1 }]);
  });
});

const solo6 = { cuotas: 6, total: 11335.38, montoCuota: 1889.23, sinInteres: true as const };

describe("cuotasFichaConCarrito", () => {
  it("nivel mayor que el del producto solo: el monto es el de UNA unidad de este producto a la lista alcanzada", () => {
    const p = { cuotasActuales: 8, proximo: null, pct: 100, montoCuota: 9999, lineasAlcanzada: [{ id: "1", qty: 3, total: 90000 }, { id: "10", qty: 2, total: 20000 }] };
    expect(cuotasFichaConCarrito(p, "10", 2, solo6)).toEqual({ cuotas: 8, total: 10000, montoCuota: 1250 });
    // la cantidad elegida no cambia el monto: es por unidad, como la línea sin carrito
    expect(cuotasFichaConCarrito(p, "10", 3, solo6)).toEqual({ cuotas: 8, total: 10000, montoCuota: 1250 });
  });
  it("redondea la cuota como montoPorCuota (centavo hacia arriba)", () => {
    const p = { cuotasActuales: 3, proximo: null, pct: 100, lineasAlcanzada: [{ id: "10", qty: 1, total: 100 }] };
    expect(cuotasFichaConCarrito(p, "10", 1, null)?.montoCuota).toBe(33.34);
  });
  it("sin la línea del producto usa el precio de la lista que ya muestra la línea", () => {
    const p = { cuotasActuales: 8, proximo: null, pct: 100 };
    expect(cuotasFichaConCarrito(p, "10", 1, solo6)).toEqual({ cuotas: 8, total: 11335.38, montoCuota: 1416.93 });
  });
  it("sin precio por ningún lado: null (no se inventa un monto)", () => {
    expect(cuotasFichaConCarrito({ cuotasActuales: 8, proximo: null, pct: 100 }, "10", 1, null)).toBeNull();
  });
  it("mismo nivel que el producto solo, menor, sin nivel o sin progreso: null", () => {
    expect(cuotasFichaConCarrito({ cuotasActuales: 6, proximo: null, pct: 100 }, "10", 1, solo6)).toBeNull();
    expect(cuotasFichaConCarrito({ cuotasActuales: null, proximo: null, pct: 100 }, "10", 1, solo6)).toBeNull();
    expect(cuotasFichaConCarrito(null, "10", 1, solo6)).toBeNull();
  });
});

describe("metaCuotasFicha", () => {
  it("la línea ya dice el nivel y hay uno más alto: sólo cuánto falta, con la barra y sin 'ya tiene'", () => {
    const m = metaCuotasFicha({ cuotasActuales: 8, proximo: { cuotas: 12, falta: 15000, minimo: 60000 }, pct: 75 }, true);
    expect(m).toMatchObject({ id: "cuotas", alcanzada: false, pct: 75 });
    expect(sinNbsp(m?.texto)).toBe("Sume $ 15.000 más y pague en 12 cuotas sin interés.");
    expect(sinNbsp(m?.enfasis)).toBe("$ 15.000");
    expect(m?.textoAlcanzado).toBeUndefined();
  });
  it("la línea ya dice el nivel y no hay más: sin recuadro (no repetir ni contradecir)", () => {
    expect(metaCuotasFicha({ cuotasActuales: 12, proximo: null, pct: 100 }, true)).toBeNull();
  });
  it("sin nivel mayor: cuánto falta con su carrito y este producto", () => {
    for (const actuales of [null, 6]) {
      const m = metaCuotasFicha({ cuotasActuales: actuales, proximo: { cuotas: 8, falta: 15000, minimo: 60000 }, pct: 75 });
      expect(sinNbsp(m?.texto)).toBe("Le faltan $ 15.000 para pagar en 8 cuotas sin interés.");
      expect(sinNbsp(m?.enfasis)).toBe("$ 15.000");
    }
  });
  it("sin progreso o sin nada que informar: null", () => {
    expect(metaCuotasFicha(null)).toBeNull();
    expect(metaCuotasFicha(undefined)).toBeNull();
    expect(metaCuotasFicha({ cuotasActuales: null, proximo: null, pct: 100 })).toBeNull();
    expect(metaCuotasFicha({ cuotasActuales: 6, proximo: null, pct: 100 })).toBeNull();
  });
  it("textos en usted, sin voseo", () => {
    const textos = [
      metaCuotasFicha({ cuotasActuales: 8, proximo: { cuotas: 12, falta: 1, minimo: 2 }, pct: 50 }, true),
      metaCuotasFicha({ cuotasActuales: null, proximo: { cuotas: 6, falta: 1, minimo: 2 }, pct: 50 }),
    ].map((m) => m?.texto).join(" ") + TEXTOS_CUOTAS.enComprasDesde(30000);
    expect(textos).not.toMatch(/\b(tu|tus|te|vos|sumá|pagá|tenés)\b/i);
    expect(TEXTOS_CUOTAS.enComprasDesde(30000).replace(/\u00a0/g, " ")).toBe("En compras desde $ 30.000");
  });
});

describe("cuotasHastaFicha", () => {
  const op = (cuotas: number, total: number) => ({ cuotas, total, montoCuota: total / cuotas, sinInteres: true as const });

  it("el nivel mayor que el producto solo no alcanza, con su mínimo (el menor entre medios)", () => {
    const h = cuotasHastaFicha({
      medios: [
        { slug: "a", medio: "A", opciones: [op(6, 5382.06)], noAlcanzadas: [{ cuotas: 8, minimo: 30000 }, { cuotas: 12, minimo: 90000 }] },
        { slug: "b", medio: "B", opciones: [op(3, 5000)], noAlcanzadas: [{ cuotas: 12, minimo: 80000 }] },
      ],
    });
    expect(h).toEqual({ cuotas: 12, minimo: 80000 });
    expect(sinNbsp(TEXTOS_CUOTAS.hastaCuotasDesde(h!.cuotas, h!.minimo))).toBe(
      "Hasta 12 cuotas sin interés en compras desde $ 80.000",
    );
  });
  it("un nivel que otro medio ya ofrece para el producto, o menor que el que tiene: no cuenta", () => {
    expect(
      cuotasHastaFicha({
        medios: [
          { slug: "a", medio: "A", opciones: [op(3, 100)], noAlcanzadas: [{ cuotas: 6, minimo: 500 }] },
          { slug: "b", medio: "B", opciones: [op(12, 120)], noAlcanzadas: [{ cuotas: 8, minimo: 300 }] },
        ],
      }),
    ).toBeNull();
  });
  it("sin cuotas, sin mínimos o sin nada por arriba: null", () => {
    expect(cuotasHastaFicha(undefined)).toBeNull();
    expect(cuotasHastaFicha({ medios: [{ slug: "a", medio: "A", opciones: [op(6, 600)] }] })).toBeNull();
  });
  it("el producto solo no tiene cuotas: igual informa el nivel mayor", () => {
    expect(
      cuotasHastaFicha({ medios: [{ slug: "a", medio: "A", opciones: [], noAlcanzadas: [{ cuotas: 3, minimo: 10000 }, { cuotas: 6, minimo: 20000 }] }] }),
    ).toEqual({ cuotas: 6, minimo: 20000 });
  });
});
