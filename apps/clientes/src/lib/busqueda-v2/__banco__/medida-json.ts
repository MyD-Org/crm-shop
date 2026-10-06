/**
 * Evaluación de medidas de un caso, en la forma compacta que se escribe en el JSON de la corrida
 * (`CasoJson.medida`). Sólo conteos: nunca nombres de productos; los ids de producto que contradicen van
 * únicamente con `--ids`. En un banco enmascarado (local o privado) el valor esperado se omite y el plan
 * se reduce a claves, porque un id de medida (`corriente_a:20`) cita parte de la consulta.
 */
import type { EvaluacionMedida } from "./medida-oraculo";
import { claveDeId } from "./medida-oraculo";

export interface MedidaEsperadaJson {
  clave: string;
  /** Ausente en un banco enmascarado. */
  valor?: string;
  dura: boolean;
  con: number;
  cumple: number;
  contradice: number;
  duras: number;
  /** `--ids`: ids de los productos del top 24 que contradicen. */
  contradicen?: string[];
}

export interface MedidaJson {
  hit: boolean | null;
  falsoPositivo: boolean | null;
  /** Productos que miró la evaluación (la primera página, hasta 24): denominador de la cobertura. */
  pagina: number;
  /** Ids de medida que produjo el plan (claves en un banco enmascarado). Ausente = la tubería no produce medidas. */
  plan?: string[];
  /** De `plan`, los que quedaron como filtro duro. */
  duros?: string[];
  esperadas: MedidaEsperadaJson[];
}

export interface OpcionesMedidaJson {
  enmascarar: boolean;
  ids: boolean;
  pagina: number;
}

/** Id de medida reducido a su clave (los ids que no son de medida quedan tal cual). */
const aClave = (id: string): string => claveDeId(id) ?? id;
const unicos = (xs: string[]): string[] => [...new Set(xs)];

export function medidaParaJson(m: EvaluacionMedida, { enmascarar, ids, pagina }: OpcionesMedidaJson): MedidaJson {
  const ver = (xs: string[]) => (enmascarar ? unicos(xs.map(aClave)) : xs);
  return {
    hit: m.hit,
    falsoPositivo: m.falsoPositivo,
    pagina,
    ...(m.emitidas ? { plan: ver(m.emitidas) } : {}),
    ...(m.emitidasDuras ? { duros: ver(m.emitidasDuras) } : {}),
    esperadas: m.detalle.map((d) => ({
      clave: d.clave,
      ...(enmascarar ? {} : { valor: d.valor }),
      dura: d.dura,
      con: d.con,
      cumple: d.cumple,
      contradice: d.contradice,
      duras: d.duras,
      ...(ids && d.contradicen.length ? { contradicen: d.contradicen } : {}),
    })),
  };
}
