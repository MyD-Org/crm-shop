import { describe, expect, it } from "vitest";
import type { EvaluacionBusqueda } from "./banco";
import { cortarPor, percentil, resumenNumerico } from "./metricas";

/** Evaluación mínima: cada test pisa sólo lo que le importa. */
function ev(p: Partial<EvaluacionBusqueda> = {}): EvaluacionBusqueda {
  return {
    q: "consulta",
    diagnostico: false,
    intencionOk: null,
    categoriaOk: null,
    atributosOk: null,
    top24Ok: null,
    posicion: null,
    sinResultadosIndebido: false,
    puntos: 0,
    posibles: 0,
    total: 10,
    perfil: "particular",
    tipo: "producto",
    rr: null,
    precision: null,
    zero: false,
    ...p,
  };
}

describe("percentil (rango más cercano)", () => {
  const diez = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it("p50 = 50 y p95 = 100 sobre [10..100]", () => {
    expect(percentil(diez, 50)).toBe(50);
    expect(percentil(diez, 95)).toBe(100);
  });

  it("no depende del orden de entrada", () => {
    expect(percentil([...diez].reverse(), 50)).toBe(50);
  });

  it("con un solo valor, todos los percentiles son ese valor", () => {
    expect(percentil([30], 50)).toBe(30);
    expect(percentil([30], 95)).toBe(30);
  });

  it("sin muestras devuelve 0", () => {
    expect(percentil([], 50)).toBe(0);
  });
});

describe("resumenNumerico", () => {
  it("MRR: posiciones 1, 4 y ausente => 0.4167", () => {
    const evs = [
      ev({ top24Ok: true, posicion: 1, rr: 1 }),
      ev({ top24Ok: true, posicion: 4, rr: 0.25 }),
      ev({ top24Ok: false, posicion: null, rr: 0 }),
    ];
    expect(resumenNumerico(evs, true).mrr).toBeCloseTo(0.4167, 4);
  });

  it("MRR ignora los casos sin expectativa de producto", () => {
    const evs = [ev({ rr: 1 }), ev({ rr: null })];
    expect(resumenNumerico(evs, true).mrr).toBe(1);
  });

  it("hit@24 y hit@3 salen de los casos con expectativa", () => {
    const evs = [
      ev({ top24Ok: true, posicion: 2, rr: 0.5 }),
      ev({ top24Ok: true, posicion: 10, rr: 0.1 }),
      ev({ top24Ok: false, rr: 0 }),
      ev({ top24Ok: null }),
    ];
    const r = resumenNumerico(evs, true);
    expect(r.hit24).toBeCloseTo(2 / 3, 5);
    expect(r.hit3).toBeCloseTo(1 / 3, 5);
  });

  it("precision@24: promedio de los casos con criterio; los demás se excluyen y se cuentan", () => {
    const evs = [ev({ precision: 0.75 }), ev({ precision: 0.5 }), ev({ precision: null }), ev({ precision: null })];
    const r = resumenNumerico(evs, true);
    expect(r.precision24).toBeCloseTo(0.625, 5);
    expect(r.precisionExcluidos).toBe(2);
  });

  it("zero-result total vs indebido", () => {
    const evs = [
      ev({ zero: true, sinResultadosIndebido: true }),
      ev({ zero: true, sinResultadosIndebido: false }),
      ev(),
      ev(),
    ];
    const r = resumenNumerico(evs, true);
    expect(r.zeroTotal).toBe(2);
    expect(r.zeroIndebido).toBe(1);
    expect(r.zeroRate).toBeCloseTo(2 / 4, 5);
    expect(r.zeroIndebidoRate).toBeCloseTo(1 / 4, 5);
  });

  it("intención sólo si la tubería la produce", () => {
    const evs = [ev({ intencionOk: true }), ev({ intencionOk: false })];
    expect(resumenNumerico(evs, true).intencion).toBe(0.5);
    expect(resumenNumerico(evs, false).intencion).toBeNull();
  });

  it("latencia: p50/p95 sobre las muestras de todas las repeticiones", () => {
    const evs = [ev({ ms: 10, muestrasMs: [10, 20, 30] }), ev({ ms: 40, muestrasMs: [40, 50] })];
    const r = resumenNumerico(evs, true);
    expect(r.latencia).toEqual({ n: 5, p50: 30, p95: 50 });
  });

  it("latencia: sin muestrasMs usa ms de cada caso; sin ms, n = 0", () => {
    expect(resumenNumerico([ev({ ms: 30 })], true).latencia).toEqual({ n: 1, p50: 30, p95: 30 });
    expect(resumenNumerico([ev()], true).latencia).toEqual({ n: 0, p50: 0, p95: 0 });
  });

  it("sin casos: sin NaN ni división por cero", () => {
    const r = resumenNumerico([], true);
    expect(r.n).toBe(0);
    for (const v of [r.hit24, r.hit3, r.mrr, r.precision24, r.posMedia, r.intencion]) expect(v).toBeNull();
    expect(r.zeroRate).toBe(0);
    expect(r.puntaje).toBe(0);
    expect(JSON.stringify(r)).not.toMatch(/NaN/);
  });

  it("versión ponderada sólo si algún caso trae peso", () => {
    const sin = [ev({ top24Ok: true, posicion: 1, rr: 1 }), ev({ top24Ok: false, rr: 0 })];
    expect(resumenNumerico(sin, true).ponderado).toBeUndefined();

    const con = [
      ev({ top24Ok: true, posicion: 1, rr: 1, peso: 9 }),
      ev({ top24Ok: false, rr: 0, zero: true, peso: 1 }),
    ];
    const r = resumenNumerico(con, true);
    expect(r.ponderado).toBeDefined();
    expect(r.ponderado!.hit24).toBeCloseTo(0.9, 5);
    expect(r.ponderado!.mrr).toBeCloseTo(0.9, 5);
    expect(r.ponderado!.zeroRate).toBeCloseTo(0.1, 5);
  });

  it("puntaje: igual a puntos/posibles", () => {
    const evs = [ev({ puntos: 3, posibles: 4 }), ev({ puntos: 1, posibles: 4 })];
    expect(resumenNumerico(evs, true).puntaje).toBe(50);
  });
});

describe("cortarPor", () => {
  it("una fila por tipo con n, hit@24, MRR, precisión, zero y latencia", () => {
    const evs = [
      ...Array.from({ length: 15 }, () => ev({ tipo: "typo", top24Ok: true, posicion: 1, rr: 1, precision: 0.8, ms: 10 })),
      ...Array.from({ length: 15 }, () => ev({ tipo: "medida", top24Ok: false, rr: 0, precision: 0.2, zero: true, ms: 20 })),
    ];
    const cortes = cortarPor(evs, "tipo", true);
    expect(Object.keys(cortes).sort()).toEqual(["medida", "typo"]);
    expect(cortes.typo).toMatchObject({ n: 15, hit24: 1, mrr: 1, zeroTotal: 0 });
    expect(cortes.typo.precision24).toBeCloseTo(0.8, 5);
    expect(cortes.typo.latencia.p50).toBe(10);
    expect(cortes.medida).toMatchObject({ n: 15, hit24: 0, mrr: 0, zeroTotal: 15 });
    expect(cortes.medida.latencia.p95).toBe(20);
  });

  it("corta por perfil e intención esperada", () => {
    const evs = [ev({ perfil: "particular" }), ev({ perfil: "profesional" }), ev({ perfil: "profesional", intencionEsperada: "producto" })];
    expect(cortarPor(evs, "perfil", true).profesional.n).toBe(2);
    const porIntencion = cortarPor(evs, "intencionEsperada", true);
    expect(porIntencion.producto.n).toBe(1);
    expect(porIntencion["(sin intención)"].n).toBe(2);
  });

  it("un corte sin casos (p. ej. tipo marca) no aparece ni rompe", () => {
    const cortes = cortarPor([ev({ tipo: "typo" })], "tipo", true);
    expect(cortes.marca).toBeUndefined();
    expect(cortarPor([], "tipo", true)).toEqual({});
    expect(JSON.stringify(cortes)).not.toMatch(/NaN/);
  });
});
