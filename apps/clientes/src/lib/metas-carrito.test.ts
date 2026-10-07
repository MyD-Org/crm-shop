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
