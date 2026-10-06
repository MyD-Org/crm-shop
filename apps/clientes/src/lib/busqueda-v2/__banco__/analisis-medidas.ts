/**
 * Análisis de las medidas de una corrida del banco (`--json`): agrega el detalle por caso que escribe
 * `corrida.ts` (`CasoJson.medida`) para ver DÓNDE están las contradicciones y qué cambiaría si cambiara la
 * política de claves duras. Módulo PURO sobre el JSON ya leído; sólo lectura, sin base ni red.
 *
 * Privacidad (repo público): imprime lo que el JSON ya trae. Con un banco local el JSON ya viene enmascarado
 * (consulta `#idx`, plan en claves, sin valores), y los ids de producto sólo existen si la corrida se hizo con
 * `--ids` (este análisis no los imprime nunca).
 *
 * Estado de una clave en el plan de un caso (`EntradaMedida.estado`):
 * - `dura`: el plan la emitió y quedó como filtro duro.
 * - `blanda`: el plan la emitió pero no como filtro duro (sólo suma puntaje).
 * - `ausente`: el plan no emitió ninguna medida de esa clave.
 * - `sin-plan`: la tubería de la corrida no produce medidas (no hay nada que mirar).
 */
import type { CasoJson, ReporteJson } from "./corrida";
import { claveDeId } from "./medida-oraculo";

export type EstadoClave = "dura" | "blanda" | "ausente" | "sin-plan";

/** Lo mínimo de un reporte que usa el análisis (un `ReporteJson` completo cumple). */
export interface ReporteMedidas {
  cabecera: { tuberia: string; busquedaMedidas?: string; banco: { n: number; hash: string } };
  casos: CasoJson[];
}

export interface EntradaMedida {
  idx: number;
  q: string;
  clave: string;
  /** La medida esperada del banco es `dura: true`. */
  dura: boolean;
  con: number;
  cumple: number;
  contradice: number;
  duras: number;
  pagina: number;
  plan: string[] | undefined;
  estado: EstadoClave;
}

/** Id de medida del plan (o clave pura, en un banco enmascarado) → clave. */
const claveDePlan = (id: string): string => claveDeId(id) ?? id;

export function entradasDeReporte(r: ReporteMedidas): { entradas: EntradaMedida[]; casosConMedida: number; casosEvaluables: number } {
  const entradas: EntradaMedida[] = [];
  let casosConMedida = 0;
  let casosEvaluables = 0;
  for (const c of r.casos) {
    const m = c.medida;
    if (!m) continue;
    casosConMedida++;
    if (m.esperadas.length) casosEvaluables++;
    const emitidas = m.plan ? new Set(m.plan.map(claveDePlan)) : undefined;
    const duras = new Set((m.duros ?? []).map(claveDePlan));
    for (const e of m.esperadas) {
      const estado: EstadoClave = !emitidas ? "sin-plan" : duras.has(e.clave) ? "dura" : emitidas.has(e.clave) ? "blanda" : "ausente";
      entradas.push({ idx: c.idx, q: c.q ?? `#${c.idx}`, clave: e.clave, dura: e.dura, con: e.con, cumple: e.cumple, contradice: e.contradice, duras: e.duras, pagina: m.pagina, plan: m.plan, estado });
    }
  }
  return { entradas, casosConMedida, casosEvaluables };
}

export interface OpcionesRanking {
  /** Cuántas filas (por defecto todas). */
  top?: number;
  /** Por defecto sólo las entradas con contradicciones duras; `false` suma las blandas. */
  soloDuras?: boolean;
  clave?: string;
}

/** Casos ordenados por contradicciones duras (desc), luego contradicciones (desc), luego idx. */
export function rankingContradicciones(entradas: readonly EntradaMedida[], { top, soloDuras = true, clave }: OpcionesRanking = {}): EntradaMedida[] {
  const filas = entradas
    .filter((e) => (clave === undefined || e.clave === clave) && (soloDuras ? e.duras > 0 : e.contradice > 0))
    .sort((a, b) => b.duras - a.duras || b.contradice - a.contradice || a.idx - b.idx || a.clave.localeCompare(b.clave));
  return top === undefined ? filas : filas.slice(0, top);
}

export interface TotalClave {
  clave: string;
  casos: number;
  con: number;
  cumple: number;
  contradice: number;
  /** Contradicciones de medidas esperadas `dura: true`. */
  duras: number;
  /** `contradice - duras`. */
  blandas: number;
  casosConContradiccion: number;
  /** cumple / con; null si nadie tenía el dato. */
  precision: number | null;
  /** con / (productos mirados x casos). */
  cobertura: number | null;
}

const ratio = (a: number, b: number): number | null => (b ? a / b : null);

function sumar(es: readonly EntradaMedida[]) {
  const con = es.reduce((s, e) => s + e.con, 0);
  const cumple = es.reduce((s, e) => s + e.cumple, 0);
  const contradice = es.reduce((s, e) => s + e.contradice, 0);
  const duras = es.reduce((s, e) => s + e.duras, 0);
  const pagina = es.reduce((s, e) => s + e.pagina, 0);
  return { casos: es.length, con, cumple, contradice, duras, casosConContradiccion: es.filter((e) => e.contradice > 0).length, precision: ratio(cumple, con), cobertura: ratio(con, pagina) };
}

function porClave(entradas: readonly EntradaMedida[]): Map<string, EntradaMedida[]> {
  const m = new Map<string, EntradaMedida[]>();
  for (const e of entradas) m.set(e.clave, [...(m.get(e.clave) ?? []), e]);
  return m;
}

export function totalesPorClave(entradas: readonly EntradaMedida[]): TotalClave[] {
  return [...porClave(entradas)]
    .map(([clave, es]) => {
      const s = sumar(es);
      return { clave, ...s, blandas: s.contradice - s.duras };
    })
    .sort((a, b) => b.duras - a.duras || b.contradice - a.contradice || a.clave.localeCompare(b.clave));
}

export interface ResumenGrupo {
  casos: number;
  contradice: number;
  casosConContradiccion: number;
  cobertura: number | null;
}

export interface ImpactoClave {
  clave: string;
  /** Casos donde el plan dejó la clave como filtro duro. */
  dura: ResumenGrupo;
  /** Casos donde la clave quedó blanda o el plan no la emitió. */
  blanda: ResumenGrupo;
  /** Casos (idx) cuyo resultado cambiaría si la clave dejara de ser dura. */
  cambiaSiPasaABlanda: number[];
  /** Casos (idx) con la clave blanda o ausente que hoy contradicen: un filtro duro los limpiaría (pero puede vaciar o recortar). */
  cambiaSiPasaADura: number[];
}

const grupo = (es: readonly EntradaMedida[]): ResumenGrupo => {
  const s = sumar(es);
  return { casos: s.casos, contradice: s.contradice, casosConContradiccion: s.casosConContradiccion, cobertura: s.cobertura };
};

/** Qué cambiaría, por clave, si cambiara la política de claves duras. Las entradas `sin-plan` no cuentan. */
export function impactoPorClave(entradas: readonly EntradaMedida[]): ImpactoClave[] {
  const idxs = (es: readonly EntradaMedida[]) => [...new Set(es.map((e) => e.idx))].sort((a, b) => a - b);
  return [...porClave(entradas.filter((e) => e.estado !== "sin-plan"))]
    .map(([clave, es]) => {
      const duras = es.filter((e) => e.estado === "dura");
      const resto = es.filter((e) => e.estado !== "dura");
      return { clave, dura: grupo(duras), blanda: grupo(resto), cambiaSiPasaABlanda: idxs(duras), cambiaSiPasaADura: idxs(resto.filter((e) => e.contradice > 0)) };
    })
    .sort((a, b) => b.dura.contradice - a.dura.contradice || b.blanda.contradice - a.blanda.contradice || a.clave.localeCompare(b.clave));
}

// --- Lectura y formato ----------------------------------------------------------------------------------------

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Valida la forma mínima de un reporte `--json` del banco. El mensaje nunca cita el contenido. */
export function parsearReporteMedidas(json: unknown): ReporteJson & ReporteMedidas {
  if (!esObjeto(json) || !esObjeto(json.cabecera) || !Array.isArray(json.casos)) {
    throw new Error("El archivo no tiene la forma de un reporte del banco (--json de banco:busqueda).");
  }
  return json as unknown as ReporteJson & ReporteMedidas;
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(100 * x).toFixed(1)}%`);
const lista = (xs: readonly number[], max = 12) => (xs.length ? (xs.length > max ? `${xs.slice(0, max).join(", ")}, … (+${xs.length - max})` : xs.join(", ")) : "ninguno");
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const cortar = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface OpcionesAnalisis {
  /** Filas del ranking (por defecto 20; con `clave`, 50). */
  top?: number;
  /** Limita ranking, totales e impacto a una clave. */
  clave?: string;
}

export function formatearAnalisis(r: ReporteMedidas, { top, clave }: OpcionesAnalisis = {}): string {
  const { entradas: todas, casosConMedida, casosEvaluables } = entradasDeReporte(r);
  const entradas = clave === undefined ? todas : todas.filter((e) => e.clave === clave);
  const c = r.cabecera;
  const lineas = [
    `Análisis de medidas — tubería ${c.tuberia}; busqueda-medidas: ${c.busquedaMedidas ?? "no aplica"}; banco n=${c.banco.n}, hash ${c.banco.hash}${clave ? `; clave ${clave}` : ""}`,
    `${plural(casosConMedida, "caso con medida", "casos con medida")}, ${plural(casosEvaluables, "evaluable", "evaluables")} (con medidas esperadas).`,
  ];
  if (!casosConMedida) {
    lineas.push("", "Este JSON no trae el detalle de medidas (se generó con una versión anterior del banco o el banco no declara medidas).", "Vuelva a correr la corrida con --json=<ruta> (y --ids si quiere ids de producto en el archivo).");
    return `${lineas.join("\n")}\n`;
  }

  // (a) Ranking
  lineas.push("", "## Casos con contradicciones duras", "(contradicción dura = un producto de la primera página con dato que no cumple una medida esperada `dura`; estado = qué hizo el plan con esa clave)");
  const soloDuras = clave === undefined;
  const ranking = rankingContradicciones(entradas, { top: top ?? (clave ? 50 : 20), soloDuras });
  const total = rankingContradicciones(entradas, { soloDuras }).length;
  if (!ranking.length) lineas.push(soloDuras ? "Ninguna contradicción dura." : `Ninguna contradicción en la clave ${clave}.`);
  else {
    lineas.push("idx | consulta | plan | clave | contradicen/con | estado");
    for (const e of ranking) lineas.push(`${e.idx} | ${cortar(e.q)} | ${e.plan ? (e.plan.length ? e.plan.join(", ") : "(sin medidas)") : "(la tubería no produce medidas)"} | ${e.clave} | ${soloDuras ? e.duras : e.contradice}/${e.con} | ${e.estado}`);
    if (total > ranking.length) lineas.push(`… ${total - ranking.length} más (use --top=N).`);
  }

  // (b) Totales por clave
  lineas.push("", "## Totales por clave", "clave | casos | contradicciones duras | blandas | con dato | precisión | cobertura");
  for (const t of totalesPorClave(entradas)) lineas.push(`${t.clave} | ${t.casos} | ${t.duras} | ${t.blandas} | ${t.con} | ${pct(t.precision)} | ${pct(t.cobertura)}`);

  // (c) Impacto de la política
  const impacto = impactoPorClave(entradas);
  lineas.push("", "## Si cambiara la política de claves duras", "(sólo cuenta lo que el plan hizo con cada clave; los casos se identifican por idx)");
  if (!impacto.length) lineas.push("Sin plan en este JSON: la tubería no produce medidas.");
  for (const i of impacto) {
    lineas.push(
      `${i.clave}: dura en el plan ${plural(i.dura.casos, "caso", "casos")} (${i.dura.contradice} contradicen en ${i.dura.casosConContradiccion}, cobertura ${pct(i.dura.cobertura)}) | blanda o ausente ${plural(i.blanda.casos, "caso", "casos")} (${i.blanda.contradice} contradicen en ${i.blanda.casosConContradiccion}, cobertura ${pct(i.blanda.cobertura)}) | pasa a blanda: ${lista(i.cambiaSiPasaABlanda)} | pasa a dura: ${lista(i.cambiaSiPasaADura)}`,
    );
  }
  return `${lineas.join("\n")}\n`;
}

export interface ArgsAnalisis extends OpcionesAnalisis {
  /** Ruta del JSON de la corrida (`--json` de `banco:busqueda`). */
  archivo: string;
}

export const USO_ANALISIS = "Uso: npm run banco:analizar-medidas -- <reporte.json> [--top=N] [--clave=<clave>]";

/** Parseo puro de los argumentos del script. Los mensajes no citan el valor recibido. */
export function parsearArgsAnalisis(argv: readonly string[]): ArgsAnalisis {
  let archivo: string | undefined;
  let top: number | undefined;
  let clave: string | undefined;
  for (const a of argv) {
    if (a.startsWith("--top=")) {
      const n = Number(a.slice(6));
      if (!Number.isInteger(n) || n < 1) throw new Error(`--top espera un entero positivo. ${USO_ANALISIS}`);
      top = n;
    } else if (a.startsWith("--clave=")) {
      clave = a.slice(8);
      if (!/^[a-z][a-z0-9_]{1,19}$/.test(clave)) throw new Error(`--clave espera una clave de medida (por ejemplo polos o corriente_a). ${USO_ANALISIS}`);
    } else if (a.startsWith("--")) {
      throw new Error(`Argumento desconocido. ${USO_ANALISIS}`);
    } else if (archivo === undefined) archivo = a;
    else throw new Error(`Se espera un solo archivo. ${USO_ANALISIS}`);
  }
  if (archivo === undefined) throw new Error(USO_ANALISIS);
  return { archivo, ...(top !== undefined ? { top } : {}), ...(clave !== undefined ? { clave } : {}) };
}
