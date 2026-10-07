import {
  extraerAtributosDeNombre,
  pareceCable,
  type ClaveAtributo,
} from "./catalogo-atributos-extraccion"
import type { FilaAtributo, FuenteAtributo } from "./catalogo-atributos-repo"

/**
 * Auditoría y backfill por nombre de una clave (`CLAVES_BACKFILL_NOMBRE`) (lógica PURA, sin DB): la usan los scripts
 * `atributos-auditoria.ts` y `backfill-seccion-cables.ts`.
 *
 * Los rangos de abajo son PLAUSIBLES, más angostos que los cerrados de `DEFINICION_ATRIBUTOS` (esos
 * son los que el sistema ACEPTA; estos son los que se esperan en un catálogo de iluminación y
 * material eléctrico). Un valor fuera de acá no es necesariamente un error: es una fila para mirar.
 * Heurística: ajustarlos acá si la auditoría marca de más.
 */
export const RANGOS_PLAUSIBLES: Partial<Record<ClaveAtributo, [number, number]>> = {
  potencia_w: [0.1, 2000],
  temperatura_k: [1800, 10000],
  ip: [10, 68],
  flujo_lm: [1, 40_000],
  tension_v: [5, 1000],
  corriente_a: [0.1, 2000],
  polos: [1, 4],
  seccion_mm2: [0.5, 630],
  poder_corte_ka: [1, 50],
  sensibilidad_ma: [5, 1000],
  largo_m: [0.1, 500],
  angulo_grados: [1, 360],
  leds_m: [1, 1000],
  potencia_w_m: [0.1, 100],
  leds_rollo: [1, 5000],
  diametro_mm: [10, 160],
  ancho_mm: [50, 600],
}

export interface FilaAuditada {
  alegraId: string
  clave: string
  valorNum: number | null
  valorTexto: string | null
  fuente: string
  nombre: string
  publicado: boolean
}

export interface FueraDeRango extends FilaAuditada {
  min: number
  max: number
}

/** Filas numéricas cuyo valor cae fuera del rango plausible de su clave (las de texto no se miden). */
export function fueraDeRango(filas: readonly FilaAuditada[]): FueraDeRango[] {
  const out: FueraDeRango[] = []
  for (const f of filas) {
    const r = RANGOS_PLAUSIBLES[f.clave as ClaveAtributo]
    if (!r || f.valorNum == null) continue
    if (f.valorNum < r[0] || f.valorNum > r[1]) out.push({ ...f, min: r[0], max: r[1] })
  }
  return out
}

/** Cuántas filas fuera de rango hay por clave (para la consola: sólo conteos). */
export function contarFueraDeRango(hallazgos: readonly FueraDeRango[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const h of hallazgos) out[h.clave] = (out[h.clave] ?? 0) + 1
  return out
}

export interface ProductoAuditado {
  alegraId: string
  name: string
  description: string | null
  publicado: boolean
}

export interface CableSinSeccion {
  alegraId: string
  nombre: string
  /** Lo que sacaría el extractor hoy del nombre; null = tampoco lo lee. */
  seccionDelNombre: number | null
}

/** Productos cuyo nombre es de un cable y no tienen fila `seccion_mm2` (de ninguna fuente). */
export function cablesSinSeccion(
  productos: readonly ProductoAuditado[],
  conSeccion: ReadonlySet<string>,
): CableSinSeccion[] {
  const out: CableSinSeccion[] = []
  for (const p of productos) {
    if (conSeccion.has(p.alegraId) || !pareceCable(p.name, p.description)) continue
    out.push({ alegraId: p.alegraId, nombre: p.name, seccionDelNombre: seccionDeNombre(p.name, p.description) })
  }
  return out
}

/** `seccion_mm2` que lee el extractor del nombre (+ descripción); null si no lee ninguna. */
export function seccionDeNombre(nombre: string, descripcion?: string | null): number | null {
  const a = extraerAtributosDeNombre(nombre, descripcion).find((x) => x.clave === "seccion_mm2")
  return a?.valorNum ?? null
}

export interface FilaGuardada {
  fuente: FuenteAtributo
  valorNum: number | null
  /** Para las claves de texto (montaje, tono). Ausente = null. */
  valorTexto?: string | null
}

/**
 * Claves que el backfill por nombre sabe escribir (`scripts/backfill-seccion-cables.ts --clave <clave>`).
 * Numéricas (valor_num) y de texto (`montaje`, `tono`: valor_texto).
 */
export const CLAVES_BACKFILL_NOMBRE = ["seccion_mm2", "diametro_mm", "ancho_mm", "polos", "largo_m", "montaje", "tono", "corriente_a"] as const
export type ClaveBackfillNombre = (typeof CLAVES_BACKFILL_NOMBRE)[number]

/** Valor numérico que lee el extractor del nombre (+ descripción) para una clave; null si no lee ninguno. */
export function valorDeNombre(clave: ClaveAtributo, nombre: string, descripcion?: string | null): number | null {
  const a = extraerAtributosDeNombre(nombre, descripcion).find((x) => x.clave === clave)
  return a?.valorNum ?? null
}

/** Valor (numérico o de texto) que lee el extractor del nombre (+ descripción) para una clave; null si no lee ninguno. */
export function atributoDeNombre(
  clave: ClaveAtributo,
  nombre: string,
  descripcion?: string | null,
): { valorNum: number | null; valorTexto: string | null } | null {
  const a = extraerAtributosDeNombre(nombre, descripcion).find((x) => x.clave === clave)
  return a ? { valorNum: a.valorNum, valorTexto: a.valorTexto } : null
}

export interface PlanBackfill {
  /** Filas a escribir con fuente 'nombre' (nuevas + las `nombre` que cambian de valor). */
  filas: FilaAtributo[]
  nuevas: number
  cambian: number
  /** Ya tienen la misma fila `nombre`: no se toca. */
  iguales: number
  /** Tienen una fila pdf/manual (manda sobre el nombre): no se pisa, aunque el valor difiera. */
  protegidas: number
  /** De las protegidas, las que el nombre diría OTRO valor (sólo informativo). */
  protegidasDistintas: number
}
export type PlanBackfillSeccion = PlanBackfill

/**
 * Qué escribiría el backfill de UNA clave (numérica o de texto): sólo esa clave, sólo fuente 'nombre',
 * nunca sobre pdf/manual y sin borrar nada. `existentes` = fila actual de la clave por alegraId (ausente = no hay).
 * En `corriente_a` sólo los RANGOS de regulación (relé térmico, guardamotor: "4-6"): la corriente suelta ya la
 * escribe la sync, y así el backfill no toca nada más.
 */
export function planearBackfillClave(
  clave: ClaveBackfillNombre,
  productos: readonly { alegraId: string; name: string; description: string | null }[],
  existentes: ReadonlyMap<string, FilaGuardada>,
): PlanBackfill {
  const plan: PlanBackfill = { filas: [], nuevas: 0, cambian: 0, iguales: 0, protegidas: 0, protegidasDistintas: 0 }
  for (const p of productos) {
    const valor = atributoDeNombre(clave, p.name, p.description)
    if (valor == null) continue
    if (clave === "corriente_a" && valor.valorTexto == null) continue
    const actual = existentes.get(p.alegraId)
    const igual = actual != null && actual.valorNum === valor.valorNum && (actual.valorTexto ?? null) === valor.valorTexto
    if (actual && actual.fuente !== "nombre") {
      plan.protegidas += 1
      if (!igual) plan.protegidasDistintas += 1
      continue
    }
    if (igual) {
      plan.iguales += 1
      continue
    }
    if (actual) plan.cambian += 1
    else plan.nuevas += 1
    plan.filas.push({ alegraId: p.alegraId, clave, valorNum: valor.valorNum, valorTexto: valor.valorTexto })
  }
  return plan
}

/** El backfill de `seccion_mm2` (la primera clave que tuvo backfill propio). */
export function planearBackfillSeccion(
  productos: readonly { alegraId: string; name: string; description: string | null }[],
  existentes: ReadonlyMap<string, FilaGuardada>,
): PlanBackfill {
  return planearBackfillClave("seccion_mm2", productos, existentes)
}
