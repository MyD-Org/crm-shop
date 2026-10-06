/**
 * Métricas agregadas de las medidas del banco (spec busqueda-medidas R5.3): funciones PURAS sobre
 * `EvaluacionBusqueda.medida`. Sólo agregados: ni consultas ni nombres de productos. `undefined` = ningún
 * caso del conjunto trae expectativa de medidas (el resumen y el reporte no cambian).
 *
 * - precisión@24: media por caso de (cumplen / con dato); los casos "n/a" (ningún producto de la página
 *   tiene el dato) se excluyen del promedio y se cuentan aparte, nunca valen 0.
 * - contradicciones@24: total de pares (producto x medida) con dato que NO cumplen; entre paréntesis las
 *   de medidas `dura: true` (objetivo 0).
 * - inversiones@24: total de pares (contradice, cumple) con el que contradice por encima del que cumple, en
 *   las claves discretas (polos, corriente, sensibilidad, zócalo); objetivo 0. Entre paréntesis, los casos
 *   que tienen alguna. Importa el ORDEN, no cuántos contradicen: una contradicción debajo de todos los que
 *   cumplen no cuenta.
 * - cobertura@24: media por caso de la fracción de la página con dato.
 * - hit: % de casos donde el plan produjo la medida; sólo cuenta si la tubería produce medidas.
 * - falsos positivos: % de los casos negativos (`medidas: []` / `sinMedidasDe`) donde el plan produjo una
 *   medida que no debía.
 */
import type { EvaluacionBusqueda } from "./banco";

export interface ResumenMedida {
  /** Casos con medidas esperadas (los negativos no cuentan acá). */
  n: number;
  hitN: number;
  hitRate: number | null;
  precision: number | null;
  /** Casos sin ningún producto con el dato en la página (n/a), fuera del promedio de precisión. */
  precisionExcluidos: number;
  contradicciones: number;
  contradiccionesDuras: number;
  /** Total de inversiones de orden en las claves discretas (objetivo 0). */
  inversiones: number;
  /** Casos con alguna inversión. */
  casosConInversion: number;
  /** Productos que contradicen por encima del último que cumple (total). */
  contradicenArriba: number;
  cobertura: number | null;
  /** Casos negativos evaluables (la tubería produce medidas). */
  negativos: number;
  falsosPositivos: number;
  falsosPositivosRate: number | null;
}

const promedio = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const suma = (xs: readonly (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);

export function resumenMedidas(evs: readonly EvaluacionBusqueda[]): ResumenMedida | undefined {
  const conMedida = evs.flatMap((e) => (e.medida ? [e.medida] : []));
  if (!conMedida.length) return undefined;
  // Casos con medidas esperadas: los negativos puros no tienen contradicciones ni cobertura (null).
  const esperadas = conMedida.filter((m) => m.contradicciones !== null);
  const precisiones = esperadas.flatMap((m) => (m.precision === null ? [] : [m.precision]));
  const hits = conMedida.flatMap((m) => (m.hit === null ? [] : [m.hit]));
  const negativos = conMedida.flatMap((m) => (m.falsoPositivo === null ? [] : [m.falsoPositivo]));
  return {
    n: esperadas.length,
    hitN: hits.length,
    hitRate: hits.length ? hits.filter(Boolean).length / hits.length : null,
    precision: promedio(precisiones),
    precisionExcluidos: esperadas.length - precisiones.length,
    contradicciones: suma(esperadas.map((m) => m.contradicciones)),
    contradiccionesDuras: suma(esperadas.map((m) => m.contradiccionesDuras)),
    inversiones: suma(esperadas.map((m) => m.inversiones)),
    casosConInversion: esperadas.filter((m) => (m.inversiones ?? 0) > 0).length,
    contradicenArriba: suma(esperadas.map((m) => m.contradicenArriba)),
    cobertura: promedio(esperadas.flatMap((m) => (m.cobertura === null ? [] : [m.cobertura]))),
    negativos: negativos.length,
    falsosPositivos: negativos.filter(Boolean).length,
    falsosPositivosRate: negativos.length ? negativos.filter(Boolean).length / negativos.length : null,
  };
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(100 * x).toFixed(1)}%`);

const ENCABEZADO = "casos | medida-hit | medida-precision@24 | contradicciones@24 (duras) | inversiones@24 (casos) | cobertura@24 | precisión n/a | falsos positivos";

function fila(nombre: string, r: ResumenMedida | undefined): string {
  if (!r) return `${nombre.padEnd(18)} | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a`;
  return [
    nombre.padEnd(18),
    r.n,
    r.hitN ? pct(r.hitRate) : "n/a",
    pct(r.precision),
    `${r.contradicciones} (${r.contradiccionesDuras})`,
    `${r.inversiones} (${r.casosConInversion})`,
    pct(r.cobertura),
    r.precisionExcluidos,
    r.negativos ? `${r.falsosPositivos}/${r.negativos} (${pct(r.falsosPositivosRate)})` : "n/a",
  ].join(" | ");
}

/** Líneas del bloque «Medidas» del reporte ampliado (vacío si ningún caso trae medidas). */
export function bloqueMedidas(evs: readonly EvaluacionBusqueda[]): string[] {
  const total = resumenMedidas(evs);
  if (!total) return [];
  return [
    "## Medidas",
    "(contra el valor estructurado real de la primera página; precisión n/a = nadie tenía el dato; medida-hit n/a = la tubería no produce medidas)",
    "",
    `corte              | ${ENCABEZADO}`,
    fila("total", total),
    fila("tipo medida", resumenMedidas(evs.filter((e) => e.tipo === "medida"))),
  ];
}
