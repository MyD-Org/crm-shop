/**
 * Modelo del banco de búsquedas: tipos de los casos y derivación del `tipo`.
 * Módulo puro y sin dependencias (lo comparten `banco.ts` y `cargar-banco.ts`
 * sin ciclo de imports). `banco.ts` lo reexporta.
 */
export type IntencionBanco = "codigo" | "producto" | "necesidad" | "pregunta";

/** Tipo de consulta para los cortes de la medición. "marca" sólo existe en bancos reales (no hay marcas en el sintético público). */
export type TipoConsulta = "codigo" | "medida" | "necesidad" | "pregunta" | "producto" | "typo" | "marca";

export const TIPOS_CONSULTA: readonly TipoConsulta[] = ["codigo", "medida", "necesidad", "pregunta", "producto", "typo", "marca"];

export const PERFILES_BANCO = ["particular", "profesional", "codigo", "desconocido"] as const;
export type PerfilBanco = (typeof PERFILES_BANCO)[number];

/** Estado de revisión de un caso de un banco real: sólo `revisado` entra a la línea base. */
export type EtiquetadoBanco = "pendiente" | "propuesto" | "revisado" | "descartado";

export const INTENCIONES_BANCO: readonly IntencionBanco[] = ["codigo", "producto", "necesidad", "pregunta"];

/**
 * Medida que el plan de la búsqueda tiene que entender. Exactamente una forma: `valor` (igual; para `ip`
 * significa "o superior"), o un rango con `min` y/o `max` (inclusivos). `dura`: la medida tiene que quedar
 * como filtro duro del plan (sólo claves discretas, y sólo con `valor`).
 */
export interface MedidaBanco {
  clave: string;
  valor?: number | string;
  min?: number;
  max?: number;
  dura?: boolean;
}

/** Claves en que "dura" tiene sentido: valores discretos que el producto cumple o contradice. */
export const CLAVES_DISCRETAS_BANCO: readonly string[] = ["polos", "corriente_a", "sensibilidad_ma", "zocalo", "tension_v", "ip"];

export interface BusquedaBanco {
  q: string;
  /** "desconocido": consultas reales todavía sin clasificar. */
  perfil: PerfilBanco;
  /** Una de las 15 búsquedas del diagnóstico del 2026-09-30. */
  diagnostico?: boolean;
  intencion?: IntencionBanco;
  /** Tipo explícito de la consulta; si falta se deriva (`tipoDe`). */
  tipo?: TipoConsulta;
  /** Veces que se buscó (banco real): pondera las métricas ponderadas. */
  peso?: number;
  etiquetado?: EtiquetadoBanco;
  /** Nombres de categoría aceptables: alcanza con que la entendida sea una. */
  categoria?: string[];
  /** Atributos que el usuario pidió explícitamente (deberían quedar duros). */
  atributosDuros?: string[];
  /** Términos del catálogo que deberían aparecer como expansión (sinónimos). */
  expande?: string[];
  /** Comienzo de palabra que algún producto de la primera página tiene que tener. */
  debeIncluirEnTop24?: string[];
  /** Alguna categoría (o descendiente) que algún producto de la primera página tiene que tener. */
  categoriaEnTop24?: string[];
  /** Ninguna categoría dura (preguntas y códigos). */
  sinDuros?: boolean;
  nuncaSinResultados?: boolean;
  /**
   * Medidas que el plan tiene que producir. `[]` (distinto de ausente) = el plan NO debe producir ninguna
   * medida (negativos: códigos como "DL-18W", "2x20" sin contexto).
   */
  medidas?: MedidaBanco[];
  /** Claves que el plan NO debe producir aunque haya otras medidas ("cable unipolar 2.5mm" no es de polos). */
  sinMedidasDe?: string[];
}

/**
 * Tipo de la consulta para los cortes. Explícito si el caso lo trae; si no, se
 * deriva: perfil o intención `codigo` => "codigo"; intención `necesidad` /
 * `pregunta` => ese tipo; el resto "producto".
 */
export function tipoDe(b: Pick<BusquedaBanco, "perfil" | "intencion" | "tipo">): TipoConsulta {
  if (b.tipo) return b.tipo;
  if (b.perfil === "codigo" || b.intencion === "codigo") return "codigo";
  if (b.intencion === "necesidad") return "necesidad";
  if (b.intencion === "pregunta") return "pregunta";
  return "producto";
}
