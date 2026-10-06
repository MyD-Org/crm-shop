/**
 * Criterios de aceptación de la cascada (spec `busqueda-motor-unico`, D-4): módulo PURO sobre los
 * reportes de una matriz (`--motor`), sin base ni red. Cada criterio compara una fila `motor/cascada`
 * contra R_s: el MEJOR valor por métrica entre la fila `motor/legado` de la MISMA superficie y las
 * filas `v2` (con la caché de planes o sin Jev), `clasica` y `tolerante` del MISMO banco y vista.
 *
 *   1. hit@K no cae más de max(1 caso, 0.5 pp).
 *   2. MRR no cae más de 0.01.
 *   3. Ningún caso con 0 resultados que otra fila sí resolvía.
 *   4. precision no cae más de 1 pp (sólo contra filas del mismo K: no es comparable entre K).
 *   5. Ningún corte (perfil, intención, tipo) con 5 casos o más cae más de 2 casos de hit@K; el
 *      corte `tipo=codigo` no cae nada (ni hit@K ni MRR).
 *   6. Lista de casos hit -> miss (por índice): sin ninguno pasa; con alguno queda a justificar.
 *   7. Latencia contra la fila legado: p95 <= 1.25x y p50 <= 1.15x.
 *   8. `sinPlanCacheado` no sube respecto de la fila legado (sólo con Jev en caché).
 *   + Mejora de typos: hit@K ESTRICTAMENTE mayor y menos zero-result en los casos `tipo=typo`,
 *     contra la fila legado.
 *
 * Privacidad (repo público): sólo agregados e índices de caso; nunca consultas ni productos.
 */
import { SUPERFICIES_BANCO, type CasoJson, type ModoJev, type PoliticaBanco, type ReporteJson, type SuperficieBanco, type Tuberia } from "./corrida";

/** Una fila de la matriz tal como la ve este módulo (`CorridaDeMatriz` es asignable). */
export interface FilaCriterios {
  id: string;
  banco: string;
  vista: string;
  tuberia: Tuberia;
  jev: ModoJev;
  politica?: PoliticaBanco;
  superficie?: SuperficieBanco;
  reporte: ReporteJson;
}

export interface Criterio {
  /** "1".."8" o "typos". */
  n: string;
  titulo: string;
  /** true = cumple, false = falla, null = no aplica o queda a justificar. */
  ok: boolean | null;
  detalle: string;
}

export interface InformeCriterios {
  id: string;
  superficie: SuperficieBanco;
  k: number;
  /** Ids de las filas que formaron R_s. */
  referencias: string[];
  criterios: Criterio[];
  /** Índices de caso que la cascada pierde y alguna referencia acierta (a justificar). */
  hitAMiss: number[];
  /** Ningún criterio falla y no quedan hit -> miss por justificar. */
  aprueba: boolean;
}

// Tolerancias (spec D-4).
const HIT_PP = 0.005;
const MRR_MAX_CAIDA = 0.01;
const PRECISION_MAX_CAIDA = 0.01;
const CORTE_MIN_N = 5;
const CORTE_MAX_CASOS = 2;
const LATENCIA_P95 = 1.25;
const LATENCIA_P50 = 1.15;
/** Margen para las comparaciones de punto flotante. */
const EPS = 1e-9;

const politicaDe = (f: FilaCriterios): PoliticaBanco | undefined => f.politica ?? f.reporte.cabecera.politica;
const superficieDe = (f: FilaCriterios): SuperficieBanco | undefined => f.superficie ?? f.reporte.cabecera.superficie?.nombre;
const kDe = (f: FilaCriterios): number => f.reporte.cabecera.superficie?.k ?? (superficieDe(f) ? SUPERFICIES_BANCO[superficieDe(f)!].k : 24);

const acierta = (c: CasoJson, k: number) => c.posicion !== null && c.posicion <= k;
const rr = (c: CasoJson, k: number) => (acierta(c, k) ? 1 / c.posicion! : 0);
const media = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const pp = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)} pp`;
const indices = (xs: readonly number[]) => xs.map((i) => `#${i}`).join(", ");

/** Los casos con expectativa de producto (los que entran a hit@K y MRR), por índice. */
const conExpectativa = (r: ReporteJson, validos: ReadonlySet<number>) => r.casos.filter((c) => validos.has(c.idx) && c.top24Ok !== null);

function hits(casos: readonly CasoJson[], k: number): number {
  return casos.filter((c) => acierta(c, k)).length;
}

function mrr(casos: readonly CasoJson[], k: number): number | null {
  return media(casos.map((c) => rr(c, k)));
}

/** Los cortes (perfil, intención, tipo) de la cascada con 5 casos o más: clave -> índices. */
function cortes(casos: readonly CasoJson[]): Map<string, number[]> {
  const mapa = new Map<string, number[]>();
  for (const c of casos) {
    for (const [dim, valor] of [["perfil", c.perfil], ["intencion", c.intencion], ["tipo", c.tipo]] as const) {
      if (!valor) continue;
      const clave = `${dim}=${valor}`;
      mapa.set(clave, [...(mapa.get(clave) ?? []), c.idx]);
    }
  }
  return mapa;
}

/**
 * Evalúa los criterios de la cascada `candidata` contra las demás filas de `todas`. `null` si no hay
 * fila legado de la misma superficie (y banco y vista) con los mismos casos: no hay con qué comparar.
 */
export function evaluarCriterios(candidata: FilaCriterios, todas: readonly FilaCriterios[]): InformeCriterios | null {
  const superficie = superficieDe(candidata);
  if (!superficie) return null;
  const k = kDe(candidata);
  const n = candidata.reporte.casos.length;
  const mismaMatriz = (f: FilaCriterios) => f !== candidata && f.banco === candidata.banco && f.vista === candidata.vista && f.reporte.casos.length === n;

  const legado = todas.find((f) => mismaMatriz(f) && f.tuberia === "motor" && politicaDe(f) === "legado" && superficieDe(f) === superficie);
  if (!legado) return null;
  const otras = todas.filter(
    (f) =>
      mismaMatriz(f) &&
      f !== legado &&
      (f.tuberia === "clasica" || f.tuberia === "tolerante" || (f.tuberia === "v2" && (f.jev === "cache" || f.jev === "no"))),
  );
  const refs = [legado, ...otras];

  // Casos sin grabación de Jev en cualquiera de las filas: fuera de todas las comparaciones.
  const excluidos = new Set<number>();
  for (const f of [candidata, ...refs]) for (const c of f.reporte.casos) if (c.sinGrabacion) excluidos.add(c.idx);
  const validos = new Set(candidata.reporte.casos.map((c) => c.idx).filter((i) => !excluidos.has(i)));

  const casosC = candidata.reporte.casos.filter((c) => validos.has(c.idx));
  const porIdx = (f: FilaCriterios) => new Map(f.reporte.casos.map((c) => [c.idx, c]));
  const refsPorIdx = refs.map(porIdx);
  const expC = conExpectativa(candidata.reporte, validos);
  const nExp = expC.length;
  const tolHit = Math.max(nExp ? 1 / nExp : 0, HIT_PP);

  const criterios: Criterio[] = [];

  // 1. hit@K
  {
    const mio = nExp ? hits(expC, k) / nExp : null;
    const mejor = Math.max(...refs.map((f) => { const e = conExpectativa(f.reporte, validos); return e.length ? hits(e, k) / e.length : 0; }));
    const ok = mio === null ? null : mejor - mio <= tolHit + EPS;
    criterios.push({ n: "1", titulo: `hit@${k} no cae más de max(1 caso, 0.5 pp)`, ok, detalle: mio === null ? "sin casos con expectativa" : `cascada ${(100 * mio).toFixed(1)}% vs mejor referencia ${(100 * mejor).toFixed(1)}% (${pp(mio - mejor)}; tolerancia ${(100 * tolHit).toFixed(1)} pp)` });
  }

  // 2. MRR
  {
    const mio = mrr(expC, k);
    const mejor = Math.max(0, ...refs.map((f) => mrr(conExpectativa(f.reporte, validos), k) ?? 0));
    const ok = mio === null ? null : mejor - mio <= MRR_MAX_CAIDA + EPS;
    criterios.push({ n: "2", titulo: "MRR no cae más de 0.01", ok, detalle: mio === null ? "sin casos con expectativa" : `cascada ${mio.toFixed(3)} vs mejor referencia ${mejor.toFixed(3)} (${(mio - mejor >= 0 ? "+" : "") + (mio - mejor).toFixed(3)})` });
  }

  // 3. zero-result
  {
    const nuevos = casosC.filter((c) => c.zero && refsPorIdx.some((m) => m.get(c.idx) && !m.get(c.idx)!.zero)).map((c) => c.idx);
    criterios.push({ n: "3", titulo: "ningún caso con 0 resultados que otra fila resolvía", ok: nuevos.length === 0, detalle: nuevos.length ? `casos nuevos con 0 resultados: ${indices(nuevos)}` : "ninguno" });
  }

  // 4. precision (sólo filas del mismo K)
  {
    const precision = (f: FilaCriterios) => media(f.reporte.casos.filter((c) => validos.has(c.idx) && c.precision !== null).map((c) => c.precision!));
    const mio = precision(candidata);
    const comparables = refs.filter((f) => kDe(f) === k).map(precision).filter((x): x is number => x !== null);
    if (mio === null || !comparables.length) {
      criterios.push({ n: "4", titulo: "precision no cae más de 1 pp (mismo K)", ok: null, detalle: "sin precision comparable" });
    } else {
      const mejor = Math.max(...comparables);
      criterios.push({ n: "4", titulo: "precision no cae más de 1 pp (mismo K)", ok: mejor - mio <= PRECISION_MAX_CAIDA + EPS, detalle: `cascada ${(100 * mio).toFixed(1)}% vs mejor referencia del mismo K ${(100 * mejor).toFixed(1)}% (${pp(mio - mejor)})` });
    }
  }

  // 5. cortes
  {
    const fallas: string[] = [];
    let evaluados = 0;
    for (const [clave, idxs] of cortes(casosC)) {
      if (idxs.length < CORTE_MIN_N) continue;
      evaluados++;
      const enCorte = (f: FilaCriterios) => conExpectativa(f.reporte, new Set(idxs));
      const mio = enCorte(candidata);
      const esCodigo = clave === "tipo=codigo";
      const maxCaida = esCodigo ? 0 : CORTE_MAX_CASOS;
      const caida = Math.max(...refs.map((f) => hits(enCorte(f), k))) - hits(mio, k);
      if (caida > maxCaida) fallas.push(`${clave} (n=${idxs.length}, -${caida} casos)`);
      else if (esCodigo) {
        const m = mrr(mio, k);
        const mejor = Math.max(0, ...refs.map((f) => mrr(enCorte(f), k) ?? 0));
        if (m !== null && mejor - m > EPS) fallas.push(`${clave} (n=${idxs.length}, MRR ${m.toFixed(3)} vs ${mejor.toFixed(3)})`);
      }
    }
    criterios.push({ n: "5", titulo: "ningún corte (n>=5) cae más de 2 casos; código no cae nada", ok: fallas.length === 0, detalle: fallas.length ? `caen: ${fallas.join("; ")}` : `${evaluados} corte(s) evaluado(s), ninguno cae` });
  }

  // 6. hit -> miss
  const hitAMiss = expC
    .filter((c) => !acierta(c, k) && refsPorIdx.some((m) => { const r = m.get(c.idx); return !!r && r.top24Ok !== null && acierta(r, k); }))
    .map((c) => c.idx);
  criterios.push({
    n: "6",
    titulo: "casos hit -> miss (a justificar uno por uno)",
    ok: hitAMiss.length === 0 ? true : null,
    detalle: hitAMiss.length ? `${hitAMiss.length} caso(s): ${indices(hitAMiss)}` : "ninguno",
  });

  // 7. latencia contra la fila legado
  {
    const a = candidata.reporte.latencia;
    const b = legado.reporte.latencia;
    if (!a.n || !b.n) {
      criterios.push({ n: "7", titulo: "latencia: p95 <= 1.25x y p50 <= 1.15x del legado", ok: null, detalle: "sin muestras de latencia" });
    } else {
      const ok = a.p95 <= b.p95 * LATENCIA_P95 + EPS && a.p50 <= b.p50 * LATENCIA_P50 + EPS;
      criterios.push({ n: "7", titulo: "latencia: p95 <= 1.25x y p50 <= 1.15x del legado", ok, detalle: `p95 ${a.p95} ms vs ${b.p95} ms legado (tope ${Math.round(b.p95 * LATENCIA_P95)}); p50 ${a.p50} ms vs ${b.p50} ms (tope ${Math.round(b.p50 * LATENCIA_P50)})` });
    }
  }

  // 8. sinPlanCacheado (sólo con Jev en caché)
  {
    const a = candidata.reporte.sinPlanCacheado;
    const b = legado.reporte.sinPlanCacheado;
    if (candidata.jev !== "cache" || a === undefined || b === undefined) {
      criterios.push({ n: "8", titulo: "sinPlanCacheado no sube respecto del legado", ok: null, detalle: "n/a (sólo con el banco real y el plan de la caché)" });
    } else {
      criterios.push({ n: "8", titulo: "sinPlanCacheado no sube respecto del legado", ok: a <= b, detalle: `${a} vs ${b} en el legado` });
    }
  }

  // Mejora de typos: contra la fila legado.
  {
    const typosC = expC.filter((c) => c.tipo === "typo");
    const idxs = new Set(typosC.map((c) => c.idx));
    // El zero-result se cuenta sobre todos los casos typo, tengan o no expectativa de producto.
    const todosTypo = casosC.filter((c) => c.tipo === "typo");
    if (!todosTypo.length) {
      criterios.push({ n: "typos", titulo: "mejora de typos: hit@K estrictamente mayor y menos zero-result", ok: null, detalle: "n/a (el banco no trae casos typo)" });
    } else {
      const enLegado = legado.reporte.casos.filter((c) => idxs.has(c.idx));
      const hitC = hits(typosC, k);
      const hitL = hits(enLegado, k);
      const zeroC = todosTypo.filter((c) => c.zero).length;
      const zeroL = legado.reporte.casos.filter((c) => c.tipo === "typo" && validos.has(c.idx) && c.zero).length;
      criterios.push({
        n: "typos",
        titulo: "mejora de typos: hit@K estrictamente mayor y menos zero-result",
        ok: hitC > hitL && zeroC < zeroL,
        detalle: `casos typo=${todosTypo.length}: hit@${k} ${hitC} vs ${hitL} en el legado; zero-result ${zeroC} vs ${zeroL}`,
      });
    }
  }

  const aprueba = criterios.every((c) => c.ok !== false) && hitAMiss.length === 0;
  return { id: candidata.id, superficie, k, referencias: refs.map((f) => f.id), criterios, hitAMiss, aprueba };
}

const marca = (ok: boolean | null, n: string) => (ok === true ? "OK" : ok === false ? "FALLA" : n === "6" ? "a justificar" : "n/a");

/**
 * Las líneas del texto de la matriz: una sección por fila `motor/cascada`, con los 8 criterios y la
 * mejora de typos. Vacío si la matriz no trae filas cascada. Sólo agregados e índices.
 */
export function formatearCriterios(todas: readonly FilaCriterios[]): string[] {
  const cascadas = todas.filter((f) => f.tuberia === "motor" && politicaDe(f) === "cascada");
  if (!cascadas.length) return [];
  const lineas = ["", "## Criterios de aceptación de la cascada (contra R_s: el mejor valor por métrica de la fila legado de la superficie y de v2 sin Jev/caché, clasica y tolerante de la misma matriz)"];
  for (const c of cascadas) {
    const nombre = `banco ${c.banco}, vista ${c.vista}, superficie ${superficieDe(c) ?? "?"}`;
    const informe = evaluarCriterios(c, todas);
    if (!informe) {
      lineas.push("", `### ${nombre}: sin fila legado de la misma superficie y los mismos casos; no hay con qué comparar.`);
      continue;
    }
    lineas.push("", `### ${nombre} (K=${informe.k}; referencias: ${informe.referencias.join(", ")})`);
    for (const cr of informe.criterios) {
      lineas.push(`${/^\d$/.test(cr.n) ? `${cr.n}.` : "+"} ${cr.titulo}: ${marca(cr.ok, cr.n)} — ${cr.detalle}`);
    }
    lineas.push(informe.aprueba ? "Resultado: cumple los criterios." : "Resultado: NO se puede aceptar todavía (hay criterios que fallan o casos hit -> miss por justificar).");
  }
  return lineas;
}
