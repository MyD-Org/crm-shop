import { describe, expect, it } from "vitest";
import { metaCuotas, metaEnvio, ordenarMetas } from "./metas-carrito";

describe("metaCuotas", () => {
  it("con próximo escalón: Le faltan $X para N cuotas sin interés.", () => {
    const m = metaCuotas({ cuotasActuales: 3, proximo: { cuotas: 6, falta: 15000, minimo: 60000 }, pct: 75 });
    expect(m).toMatchObject({ id: "cuotas", pct: 75, alcanzada: false });
    expect(m?.texto.replace(/[\u00a0\u202f]/g, " ")).toBe("Sume $ 15.000 más y pague en 6 cuotas sin interés.");
    expect(m?.enfasis?.replace(/[\u00a0\u202f]/g, " ")).toBe("$ 15.000");
  });
  it("en el escalón más alto: lleno", () => {
    expect(metaCuotas({ cuotasActuales: 12, proximo: null, pct: 100 })).toMatchObject({
      texto: "Su compra ya tiene 12 cuotas sin interés.",
      pct: 100,
      alcanzada: true,
    });
  });
  it("nivel alcanzado con cuota y uno más alto: dos líneas y barra hacia el siguiente", () => {
    const m = metaCuotas({ cuotasActuales: 8, proximo: { cuotas: 12, falta: 15000, minimo: 60000 }, pct: 75, montoCuota: 12500 });
    expect(m).toMatchObject({ pct: 75, alcanzada: false });
    const n = (t?: string) => t?.replace(/[\u00a0\u202f]/g, " ");
    expect(n(m?.textoAlcanzado)).toBe("Ya tiene 8 cuotas sin interés de $ 12.500,00.");
    expect(n(m?.enfasisAlcanzado)).toBe("8 cuotas sin interés de $ 12.500,00");
    expect(n(m?.texto)).toBe("Sume $ 15.000 más y pague en 12 cuotas sin interés.");
  });
  it("nivel más alto con cuota: una línea, barra llena", () => {
    const m = metaCuotas({ cuotasActuales: 12, proximo: null, pct: 100, montoCuota: 10000 });
    expect(m?.alcanzada).toBe(true);
    expect(m?.pct).toBe(100);
    expect(m?.textoAlcanzado).toBeUndefined();
    expect(m?.texto.replace(/[\u00a0\u202f]/g, " ")).toBe("Su compra ya tiene 12 cuotas sin interés de $ 10.000,00.");
  });
  it("sin monto de cuota (no se pudo calcular): como antes, sin inventar un monto", () => {
    const m = metaCuotas({ cuotasActuales: 8, proximo: { cuotas: 12, falta: 5, minimo: 10 }, pct: 50 });
    expect(m?.textoAlcanzado).toBeUndefined();
  });
  it("sin progreso o sin cuotas: nada", () => {
    expect(metaCuotas(null)).toBeNull();
    expect(metaCuotas(undefined)).toBeNull();
    expect(metaCuotas({ cuotasActuales: null, proximo: null, pct: 100 })).toBeNull();
  });
});

describe("ordenarMetas", () => {
  const envio = metaEnvio({ faltante: 10, pct: 40, alcanzado: false });
  const cuotas = metaCuotas({ cuotasActuales: null, proximo: { cuotas: 3, falta: 5, minimo: 10 }, pct: 80 });
  it("la más cercana primero", () => {
    expect(ordenarMetas([envio, cuotas]).map((m) => m.id)).toEqual(["cuotas", "envio"]);
  });
  it("descarta ausentes", () => {
    expect(ordenarMetas([null, cuotas]).map((m) => m.id)).toEqual(["cuotas"]);
    expect(ordenarMetas([null, null])).toEqual([]);
  });
  it("empate: envío primero", () => {
    const a = metaEnvio({ faltante: 0, pct: 100, alcanzado: true });
    const b = metaCuotas({ cuotasActuales: 6, proximo: null, pct: 100 });
    expect(ordenarMetas([b, a]).map((m) => m.id)).toEqual(["envio", "cuotas"]);
  });
});
