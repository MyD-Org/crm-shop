import { describe, expect, it } from "vitest";
import type { Cabecera, CasoJson, ReporteJson } from "./corrida";
import { evaluarCriterios, formatearCriterios, type FilaCriterios } from "./criterios";
import { resumenNumerico } from "./metricas";

/**
 * Criterios de aceptación de la cascada (spec D-4) sobre reportes sintéticos: cada criterio contra
 * R_s (el MEJOR valor por métrica entre la fila legado de la superficie y {v2 cache|sin Jev,
 * clasica, tolerante} de la MISMA matriz). Sólo agregados; los casos se nombran por índice.
 */
const cab = (extra: Partial<Cabecera> = {}): Cabecera =>
  ({
    fecha: "2026-10-06T00:00:00.000Z",
    gitSha: "abc1234",
    sucio: false,
    tuberia: "v2",
    jev: { modo: "no", modelo: null, grabadoEl: null },
    banco: { origen: "versionado", n: 0, hash: "h" },
    vista: { variante: "produccion", soloVisibles: true, soloStock: true },
    flags: {},
    snapshot: { productos: 1 } as never,
    repeticiones: 3,
    calentar: 3,
    tenantAlias: "shop",
    duracionMs: 1,
    ...extra,
  }) as Cabecera;

type Spec = { posicion: number | null; tipo?: string; perfil?: string; intencion?: string; zero?: boolean; precision?: number | null };

function caso(idx: number, s: Spec): CasoJson {
  return {
    idx,
    tipo: s.tipo ?? "producto",
    perfil: s.perfil ?? "particular",
    ...(s.intencion ? { intencion: s.intencion } : {}),
    posicion: s.posicion,
    rr: s.posicion ? 1 / s.posicion : 0,
    precision: s.precision === undefined ? 0.5 : s.precision,
    total: s.zero ? 0 : 5,
    top24Ok: s.posicion !== null,
    intencionOk: null,
    categoriaOk: null,
    atributosOk: null,
    zero: !!s.zero,
  };
}

function reporte(casos: Spec[], extra: { cab?: Partial<Cabecera>; p50?: number; p95?: number; sinPlanCacheado?: number } = {}): ReporteJson {
  const cs = casos.map((s, i) => caso(i, s));
  const resumen = resumenNumerico(
    cs.map(
      (c) =>
        ({
          q: `#${c.idx}`,
          top24Ok: c.top24Ok,
          posicion: c.posicion,
          rr: c.rr,
          precision: c.precision,
          zero: c.zero,
          sinResultadosIndebido: c.zero,
          puntos: 0,
          posibles: 0,
          total: c.total,
          intencionOk: null,
          categoriaOk: null,
          atributosOk: null,
          perfil: c.perfil,
          tipo: c.tipo,
          diagnostico: false,
          muestrasMs: [extra.p50 ?? 100],
        }) as never,
    ),
    false,
  );
  resumen.latencia = { n: cs.length, p50: extra.p50 ?? 100, p95: extra.p95 ?? 200 } as never;
  return {
    esquema: 1,
    cabecera: cab({ banco: { origen: "versionado", n: cs.length, hash: "h" }, ...extra.cab }),
    resumen,
    cortes: { perfil: {}, intencion: {}, tipo: {} },
    latencia: resumen.latencia,
    excluidos: { sinGrabacion: 0 },
    casos: cs,
    ...(extra.sinPlanCacheado !== undefined ? { sinPlanCacheado: extra.sinPlanCacheado } : {}),
  };
}

const fila = (id: string, tuberia: FilaCriterios["tuberia"], jev: FilaCriterios["jev"], r: ReporteJson, extra: Partial<FilaCriterios> = {}): FilaCriterios => ({
  id,
  banco: "sintetico",
  vista: "produccion",
  tuberia,
  jev,
  reporte: r,
  ...extra,
});

const K = { catalogo: 24, autocompletar: 8, chat: 10 } as const;
const motorCab = (superficie: keyof typeof K, politica: "legado" | "cascada") => ({
  tuberia: "motor" as const,
  politica,
  superficie: { nombre: superficie, k: K[superficie], conteo: superficie === "catalogo" },
});

/** 20 casos: los dos primeros son typos; el resto, producto. */
const base = (over: Record<number, Partial<Spec>> = {}): Spec[] =>
  Array.from({ length: 20 }, (_, i) => ({ posicion: 1, tipo: i < 2 ? "typo" : "producto", ...over[i] }));

function matriz(opciones: { legado: Spec[]; cascada: Spec[]; clasica?: Spec[]; v2?: Spec[]; superficie?: keyof typeof K; p?: { legado?: number[]; cascada?: number[] } }) {
  const s = opciones.superficie ?? "catalogo";
  const legado = fila("l", "motor", "grabado", reporte(opciones.legado, { cab: motorCab(s, "legado"), p50: opciones.p?.legado?.[0], p95: opciones.p?.legado?.[1] }), { politica: "legado", superficie: s });
  const cascada = fila("c", "motor", "grabado", reporte(opciones.cascada, { cab: motorCab(s, "cascada"), p50: opciones.p?.cascada?.[0], p95: opciones.p?.cascada?.[1] }), { politica: "cascada", superficie: s });
  const otras = [
    ...(opciones.clasica ? [fila("clasica", "clasica", "no aplica", reporte(opciones.clasica))] : []),
    ...(opciones.v2 ? [fila("v2", "v2", "no", reporte(opciones.v2))] : []),
  ];
  return { candidata: cascada, todas: [legado, cascada, ...otras] };
}

const criterio = (informe: ReturnType<typeof evaluarCriterios>, n: string) => informe!.criterios.find((c) => c.n === n)!;

describe("evaluarCriterios", () => {
  it("la fila legado igual a la cascada: los criterios 1 a 7 pasan (la mejora de typos no: no hubo mejora)", () => {
    const { candidata, todas } = matriz({ legado: base(), cascada: base() });
    const r = evaluarCriterios(candidata, todas)!;
    for (const n of ["1", "2", "3", "4", "5", "6", "7"]) expect(criterio(r, n).ok, `criterio ${n}`).toBe(true);
    expect(criterio(r, "8").ok).toBeNull(); // sin `sinPlanCacheado` (no es banco real con Jev cache)
    expect(criterio(r, "typos").ok).toBe(false);
    expect(r.aprueba).toBe(false);
  });

  it("1. hit@K: cae como máximo max(1 caso, 0.5 pp) contra el MEJOR de las referencias", () => {
    const a = matriz({ legado: base(), cascada: base({ 5: { posicion: null } }) });
    expect(criterio(evaluarCriterios(a.candidata, a.todas)!, "1").ok).toBe(true); // 1 caso de 20 = 5 pp, pero se permite 1 caso
    const b = matriz({ legado: base(), cascada: base({ 5: { posicion: null }, 6: { posicion: null } }) });
    expect(criterio(evaluarCriterios(b.candidata, b.todas)!, "1").ok).toBe(false);
    // El mejor valor puede ser el de otra fila (v2): la referencia es la mejor de todas.
    const c = matriz({ legado: base({ 5: { posicion: null }, 6: { posicion: null } }), cascada: base({ 5: { posicion: null }, 6: { posicion: null } }), v2: base() });
    expect(criterio(evaluarCriterios(c.candidata, c.todas)!, "1").ok).toBe(false);
  });

  it("2. MRR no cae más de 0.01", () => {
    const a = matriz({ legado: base(), cascada: base({ 5: { posicion: 2 } }) }); // cae 0.5/20 = 0.025
    expect(criterio(evaluarCriterios(a.candidata, a.todas)!, "2").ok).toBe(false);
    const b = matriz({ legado: base(), cascada: base() });
    expect(criterio(evaluarCriterios(b.candidata, b.todas)!, "2").ok).toBe(true);
  });

  it("3. zero-result: ningún caso con 0 resultados que otra fila sí resolvía", () => {
    const a = matriz({ legado: base(), cascada: base({ 7: { posicion: null, zero: true } }) });
    expect(criterio(evaluarCriterios(a.candidata, a.todas)!, "3").ok).toBe(false);
    const b = matriz({ legado: base({ 7: { posicion: null, zero: true } }), cascada: base() });
    expect(criterio(evaluarCriterios(b.candidata, b.todas)!, "3").ok).toBe(true);
  });

  it("4. precision no cae más de 1 pp contra filas del mismo K", () => {
    const a = matriz({ legado: base(), cascada: base(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, { posicion: 1, precision: 0.45 }]))) });
    expect(criterio(evaluarCriterios(a.candidata, a.todas)!, "4").ok).toBe(false);
  });

  it("5. cortes con n>=5: ninguno cae más de 2 casos; el corte código no cae nada", () => {
    const tipo = (t: string, over: Record<number, Partial<Spec>> = {}): Spec[] => Array.from({ length: 10 }, (_, i) => ({ posicion: 1, tipo: t, ...over[i] }));
    const a = matriz({ legado: tipo("producto"), cascada: tipo("producto", { 0: { posicion: null }, 1: { posicion: null }, 2: { posicion: null } }) });
    expect(criterio(evaluarCriterios(a.candidata, a.todas)!, "5").ok).toBe(false);
    const b = matriz({ legado: tipo("producto"), cascada: tipo("producto", { 0: { posicion: null }, 1: { posicion: null } }) });
    expect(criterio(evaluarCriterios(b.candidata, b.todas)!, "5").ok).toBe(true);
    const c = matriz({ legado: tipo("codigo"), cascada: tipo("codigo", { 0: { posicion: null } }) });
    expect(criterio(evaluarCriterios(c.candidata, c.todas)!, "5").ok).toBe(false);
    const d = matriz({ legado: tipo("codigo"), cascada: tipo("codigo", { 0: { posicion: 2 } }) });
    expect(criterio(evaluarCriterios(d.candidata, d.todas)!, "5").ok).toBe(false); // el MRR del código cae
    // Un corte con menos de 5 casos no cuenta.
    const e = matriz({ legado: tipo("codigo").slice(0, 4), cascada: tipo("codigo", { 0: { posicion: null } }).slice(0, 4) });
    expect(criterio(evaluarCriterios(e.candidata, e.todas)!, "5").ok).toBe(true);
  });

  it("5. también corta por perfil e intención", () => {
    const con = (over: Record<number, Partial<Spec>>): Spec[] => Array.from({ length: 8 }, (_, i) => ({ posicion: 1, perfil: "profesional", intencion: "necesidad", ...over[i] }));
    const a = matriz({ legado: con({}), cascada: con({ 0: { posicion: null }, 1: { posicion: null }, 2: { posicion: null } }) });
    const r = criterio(evaluarCriterios(a.candidata, a.todas)!, "5");
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/perfil=profesional/);
    expect(r.detalle).toMatch(/intencion=necesidad/);
  });

  it("6. lista cada caso hit->miss por índice (sin consultas): sin ninguno pasa; con alguno queda a justificar", () => {
    const a = matriz({ legado: base(), cascada: base({ 4: { posicion: null }, 9: { posicion: null } }) });
    const r = evaluarCriterios(a.candidata, a.todas)!;
    expect(r.hitAMiss).toEqual([4, 9]);
    expect(criterio(r, "6").ok).toBeNull();
    expect(criterio(r, "6").detalle).toMatch(/#4, #9/);
    const b = matriz({ legado: base(), cascada: base() });
    expect(criterio(evaluarCriterios(b.candidata, b.todas)!, "6").ok).toBe(true);
  });

  it("7. latencia contra la fila legado de la superficie: p95 <= 1.25x y p50 <= 1.15x", () => {
    const ok = matriz({ legado: base(), cascada: base(), p: { legado: [100, 400], cascada: [114, 500] } });
    expect(criterio(evaluarCriterios(ok.candidata, ok.todas)!, "7").ok).toBe(true);
    const mal95 = matriz({ legado: base(), cascada: base(), p: { legado: [100, 400], cascada: [100, 501] } });
    expect(criterio(evaluarCriterios(mal95.candidata, mal95.todas)!, "7").ok).toBe(false);
    const mal50 = matriz({ legado: base(), cascada: base(), p: { legado: [100, 400], cascada: [116, 400] } });
    expect(criterio(evaluarCriterios(mal50.candidata, mal50.todas)!, "7").ok).toBe(false);
  });

  it("8. sinPlanCacheado no sube respecto de la fila legado (sólo con Jev cache)", () => {
    const l = fila("l", "motor", "cache", reporte(base(), { cab: motorCab("catalogo", "legado"), sinPlanCacheado: 3 }), { politica: "legado", superficie: "catalogo" });
    const bien = fila("c", "motor", "cache", reporte(base(), { cab: motorCab("catalogo", "cascada"), sinPlanCacheado: 3 }), { politica: "cascada", superficie: "catalogo" });
    const mal = fila("c", "motor", "cache", reporte(base(), { cab: motorCab("catalogo", "cascada"), sinPlanCacheado: 4 }), { politica: "cascada", superficie: "catalogo" });
    expect(criterio(evaluarCriterios(bien, [l, bien])!, "8").ok).toBe(true);
    expect(criterio(evaluarCriterios(mal, [l, mal])!, "8").ok).toBe(false);
  });

  it("mejora de typos: hit@K ESTRICTAMENTE mayor y menos zero-result en los casos de tipo typo", () => {
    const l = base({ 0: { posicion: null, zero: true }, 1: { posicion: null, zero: true } });
    const c = base({ 0: { posicion: 1 }, 1: { posicion: null, zero: true } });
    const a = matriz({ legado: l, cascada: c });
    expect(criterio(evaluarCriterios(a.candidata, a.todas)!, "typos").ok).toBe(true);
    const sin = matriz({ legado: l, cascada: l });
    expect(criterio(evaluarCriterios(sin.candidata, sin.todas)!, "typos").ok).toBe(false);
    // Sin casos typo en el banco: no aplica.
    const nada = matriz({ legado: base().map((s) => ({ ...s, tipo: "producto" })), cascada: base().map((s) => ({ ...s, tipo: "producto" })) });
    expect(criterio(evaluarCriterios(nada.candidata, nada.todas)!, "typos").ok).toBeNull();
  });

  it("las superficies de otro K comparan hit@K desde la posición: una referencia con el acierto en 9 no cuenta para K=8", () => {
    const legado = base();
    const cascada = base();
    const clasica = base(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, { posicion: 9 }])));
    const r = matriz({ superficie: "autocompletar", legado, cascada, clasica });
    expect(criterio(evaluarCriterios(r.candidata, r.todas)!, "1").ok).toBe(true);
  });

  it("sólo las referencias de la misma matriz, banco y vista cuentan", () => {
    const { candidata, todas } = matriz({ legado: base(), cascada: base() });
    const ajena = fila("otra", "clasica", "no aplica", reporte(base()), { banco: "real" });
    const informe = evaluarCriterios(candidata, [...todas, ajena])!;
    expect(informe.referencias).toEqual(["l"]);
  });

  it("sin fila legado de la misma superficie no hay con qué comparar: null", () => {
    const { candidata } = matriz({ legado: base(), cascada: base() });
    expect(evaluarCriterios(candidata, [candidata])).toBeNull();
  });

  it("corridas con distinto banco (casos distintos) no se comparan caso a caso: null", () => {
    const { candidata, todas } = matriz({ legado: base(), cascada: base() });
    const corta = { ...todas[0], reporte: { ...todas[0].reporte, casos: todas[0].reporte.casos.slice(0, 5) } };
    expect(evaluarCriterios(candidata, [corta, candidata])).toBeNull();
  });
});

describe("formatearCriterios", () => {
  it("una sección por fila cascada con los 8 criterios y la mejora de typos, sólo agregados e índices", () => {
    const { todas } = matriz({ legado: base(), cascada: base({ 4: { posicion: null } }) });
    const texto = formatearCriterios(todas).join("\n");
    expect(texto).toMatch(/Criterios de aceptación de la cascada/);
    expect(texto).toMatch(/superficie catalogo/);
    for (const n of ["1.", "2.", "3.", "4.", "5.", "6.", "7.", "8."]) expect(texto).toContain(n);
    expect(texto).toMatch(/mejora de typos/i);
    expect(texto).toMatch(/#4/);
    expect(texto).toMatch(/OK|FALLA|n\/a|a justificar/);
  });

  it("sin filas cascada no agrega nada", () => {
    const { todas } = matriz({ legado: base(), cascada: base() });
    expect(formatearCriterios(todas.filter((f) => f.politica !== "cascada"))).toEqual([]);
  });
});
