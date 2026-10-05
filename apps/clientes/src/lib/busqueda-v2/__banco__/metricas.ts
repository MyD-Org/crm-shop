/**
 * Métricas del banco de búsquedas (línea base): funciones PURAS sobre
 * `EvaluacionBusqueda`, sin base de datos. Todas las tasas son fracciones
 * 0..1 (el reporte las imprime como %); `null` = la métrica no aplica a
 * ningún caso del conjunto (nunca NaN).
 *
 * - hit@24 / hit@3 / posición media: como siempre, sobre los casos con
 *   expectativa de producto.
 * - MRR: media de 1/posición del primer esperado (0 si no está en el top 24).
 * - precision@24 (PROXY, no es juicio humano por producto): esperados o de la
 *   categoría propia buscada / productos devueltos (no se divide por 24 si
 *   hay menos). Los casos sin criterio se excluyen y se cuentan.
 * - zero-result: total (total == 0) e indebido (`nuncaSinResultados`).
 * - latencia: p50 y p95 por rango más cercano sobre todas las muestras.
 */
import type { EvaluacionBusqueda } from "./banco";

export interface Latencia {
  n: number;
  p50: number;
  p95: number;
}

export interface ResumenNum {
  n: number;
  hit24: number | null;
  hit3: number | null;
  posMedia: number | null;
  mrr: number | null;
  precision24: number | null;
  /** Casos sin criterio de relevancia, fuera del promedio de precision@24. */
  precisionExcluidos: number;
  intencion: number | null;
  categoria: number | null;
  atributos: number | null;
  zeroTotal: number;
  zeroIndebido: number;
  zeroRate: number;
  zeroIndebidoRate: number;
  /** Puntaje 0..100 (puntos / posibles), igual que el de `resumir`. */
  puntaje: number;
  latencia: Latencia;
  /** Sólo si algún caso trae `peso` (banco real: hits de la consulta). */
  ponderado?: { hit24: number | null; mrr: number | null; zeroRate: number };
}

/** Percentil por rango más cercano (nearest-rank). Sin muestras: 0. */
export function percentil(muestras: readonly number[], p: number): number {
  if (!muestras.length) return 0;
  const orden = [...muestras].sort((a, b) => a - b);
  const rango = Math.min(orden.length, Math.max(1, Math.ceil((p / 100) * orden.length)));
  return orden[rango - 1];
}

const promedio = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const tasa = (ok: readonly boolean[]): number | null => (ok.length ? ok.filter(Boolean).length / ok.length : null);
const noNulos = <T>(xs: readonly (T | null | undefined)[]): T[] => xs.filter((x): x is T => x !== null && x !== undefined);

function latenciaDe(evs: readonly EvaluacionBusqueda[]): Latencia {
  const muestras = evs.flatMap((e) => e.muestrasMs ?? (e.ms !== undefined ? [e.ms] : []));
  return { n: muestras.length, p50: percentil(muestras, 50), p95: percentil(muestras, 95) };
}

function ponderadoDe(evs: readonly EvaluacionBusqueda[]): ResumenNum["ponderado"] {
  if (!evs.some((e) => e.peso !== undefined)) return undefined;
  const w = (e: EvaluacionBusqueda) => e.peso ?? 1;
  const suma = (xs: readonly EvaluacionBusqueda[], f: (e: EvaluacionBusqueda) => number) => xs.reduce((s, e) => s + f(e), 0);
  const conTop = evs.filter((e) => e.top24Ok !== null);
  const conRr = evs.filter((e) => e.rr !== null);
  const wTop = suma(conTop, w);
  const wRr = suma(conRr, w);
  const wTodos = suma(evs, w);
  return {
    hit24: wTop ? suma(conTop.filter((e) => e.top24Ok), w) / wTop : null,
    mrr: wRr ? suma(conRr, (e) => w(e) * (e.rr ?? 0)) / wRr : null,
    zeroRate: wTodos ? suma(evs.filter((e) => e.zero), w) / wTodos : 0,
  };
}

export function resumenNumerico(evs: readonly EvaluacionBusqueda[], conIntencion: boolean): ResumenNum {
  const conExpectativa = evs.filter((e) => e.top24Ok !== null);
  const posiciones = noNulos(evs.map((e) => e.posicion));
  const precisiones = noNulos(evs.map((e) => e.precision));
  const puntos = evs.reduce((s, e) => s + e.puntos, 0);
  const posibles = evs.reduce((s, e) => s + e.posibles, 0);
  const zeroTotal = evs.filter((e) => e.zero).length;
  const zeroIndebido = evs.filter((e) => e.sinResultadosIndebido).length;
  const resumen: ResumenNum = {
    n: evs.length,
    hit24: tasa(conExpectativa.map((e) => !!e.top24Ok)),
    hit3: tasa(conExpectativa.map((e) => e.posicion !== null && e.posicion <= 3)),
    posMedia: promedio(posiciones),
    mrr: promedio(noNulos(evs.map((e) => e.rr))),
    precision24: promedio(precisiones),
    precisionExcluidos: evs.length - precisiones.length,
    intencion: conIntencion ? tasa(noNulos(evs.map((e) => e.intencionOk))) : null,
    categoria: tasa(noNulos(evs.map((e) => e.categoriaOk))),
    atributos: tasa(noNulos(evs.map((e) => e.atributosOk))),
    zeroTotal,
    zeroIndebido,
    zeroRate: evs.length ? zeroTotal / evs.length : 0,
    zeroIndebidoRate: evs.length ? zeroIndebido / evs.length : 0,
    puntaje: posibles ? Math.round((1000 * puntos) / posibles) / 10 : 0,
    latencia: latenciaDe(evs),
  };
  const ponderado = ponderadoDe(evs);
  if (ponderado) resumen.ponderado = ponderado;
  return resumen;
}

export type ClaveCorte = "perfil" | "intencionEsperada" | "tipo";

const SIN_INTENCION = "(sin intención)";

/** Resumen por valor del corte (claves ordenadas: salida estable). Un corte sin casos no aparece. */
export function cortarPor(evs: readonly EvaluacionBusqueda[], k: ClaveCorte, conIntencion: boolean): Record<string, ResumenNum> {
  const grupos = new Map<string, EvaluacionBusqueda[]>();
  for (const e of evs) {
    const clave = k === "intencionEsperada" ? (e.intencionEsperada ?? SIN_INTENCION) : e[k];
    grupos.set(clave, [...(grupos.get(clave) ?? []), e]);
  }
  return Object.fromEntries([...grupos.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([clave, g]) => [clave, resumenNumerico(g, conIntencion)]));
}
