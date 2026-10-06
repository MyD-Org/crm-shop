/**
 * Paridad entre dos corridas del banco: ¿devuelven lo mismo, caso por caso? Se usa para probar que
 * una limpieza no cambia nada (frente a una corrida guardada con `--json` y `--ids`). Módulo PURO.
 *
 * Privacidad (repo público): el resultado sólo habla de índices y motivos; ni consultas de un banco
 * privado ni ids de productos llegan a la consola.
 */
import type { ReporteJson } from "./corrida";

export interface CasoParidad {
  /** Ids de lo devuelto, en orden. */
  ids: string[];
  total: number;
}

export type MotivoDiferencia = "ids" | "orden" | "total";

export interface ResultadoParidad {
  /** Cuántos productos del principio se comparan (el K de la superficie). */
  n: number;
  casos: number;
  diferencias: { idx: number; motivo: MotivoDiferencia }[];
}

/**
 * Compara el top-`n` de ids caso por caso: otros productos = `ids`; los mismos en otro orden =
 * `orden`; y, en las superficies que cuentan el total (`conteo`), otro total = `total`. Un caso que
 * falta en una de las dos corridas es una diferencia de `ids`.
 */
export function compararParidad(
  a: readonly CasoParidad[],
  b: readonly CasoParidad[],
  { n, conteo }: { n: number; conteo: boolean },
): ResultadoParidad {
  const casos = Math.max(a.length, b.length);
  const diferencias: ResultadoParidad["diferencias"] = [];
  for (let idx = 0; idx < casos; idx++) {
    const x = a[idx];
    const y = b[idx];
    if (!x || !y) {
      diferencias.push({ idx, motivo: "ids" });
      continue;
    }
    const xs = x.ids.slice(0, n);
    const ys = y.ids.slice(0, n);
    if (xs.length !== ys.length || [...xs].sort().join("\u0000") !== [...ys].sort().join("\u0000")) {
      diferencias.push({ idx, motivo: "ids" });
    } else if (xs.some((id, i) => id !== ys[i])) {
      diferencias.push({ idx, motivo: "orden" });
    } else if (conteo && x.total !== y.total) {
      diferencias.push({ idx, motivo: "total" });
    }
  }
  return { n, casos, diferencias };
}

/** Los ids y el total de cada caso de un reporte. Exige que la corrida se haya hecho con `--ids`. */
export function idsDeReporte(reporte: ReporteJson): CasoParidad[] {
  return reporte.casos.map((c) => {
    if (!c.ids) throw new Error("La corrida no trae ids por caso: vuelva a correrla con --ids.");
    return { ids: c.ids, total: c.total };
  });
}

export function formatearParidad(
  r: ResultadoParidad,
  { enmascarar, consultas }: { enmascarar: boolean; consultas?: readonly string[] },
): string {
  const encabezado = `[paridad] ${r.casos} casos, top ${r.n}: ${r.diferencias.length} diferencias.`;
  if (r.diferencias.length === 0) return encabezado;
  const lineas = r.diferencias.map(({ idx, motivo }) => {
    const q = !enmascarar && consultas?.[idx] !== undefined ? ` «${consultas[idx]}»` : "";
    return `  #${idx}${q} (${motivo})`;
  });
  return [encabezado, ...lineas].join("\n");
}
