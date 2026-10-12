import { normalizarCodigo } from "./alegra-pareo"

// Variantes de producto (change `variantes-de-producto`, rebanada S2). Puro: sin base ni Alegra.
//
// Alegra modela un producto con opciones como un PADRE (`type: "variantParent"`, no se vende) y
// sus HIJOS (`type: "variant"`, ítems reales con id, precio, stock y código propios). Cada hijo
// trae `idItemParent` y `variantAttributes` ([{name, options:[{value}]}], una opción por atributo).
//
// Lo que se verificó contra Alegra real (2026-10-11): `type` e `idItemParent` llegan SIEMPRE;
// `variantAttributes` llega sólo con `fields=inventory,variantAttributes` (con `fields=inventory`
// solo viene null). Por eso la opción también se puede derivar del nombre: la convención del
// catálogo es "Modelo / Opción".

export type TipoItem = "simple" | "padre" | "variante"

export interface VarianteOpcion {
  atributo: string
  opcion: string
}

/** Nombre de atributo de una opción derivada del nombre (Alegra no la entregó como atributo). */
export const ATRIBUTO_DERIVADO = "Opción"

const SEPARADOR = " / "

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "")

/** `variantParent` → padre, `variant` → variante, cualquier otra cosa (o nada) → simple. */
export function tipoDeItem(raw: Record<string, unknown>): TipoItem {
  const t = texto(raw.type).toLowerCase()
  if (t === "variantparent") return "padre"
  if (t === "variant") return "variante"
  return "simple"
}

/** Id (en la cuenta de origen) del padre de una variante; null para padres y simples. */
export function padreDeItem(raw: Record<string, unknown>): string | null {
  if (tipoDeItem(raw) !== "variante") return null
  const p = raw.idItemParent
  const id = p !== null && typeof p === "object" ? texto((p as { id?: unknown }).id) : texto(p)
  return id || null
}

function opcionesDeAtributos(raw: Record<string, unknown>): VarianteOpcion[] {
  if (!Array.isArray(raw.variantAttributes)) return []
  const out: VarianteOpcion[] = []
  for (const a of raw.variantAttributes as unknown[]) {
    if (a === null || typeof a !== "object") continue
    const { name, options } = a as { name?: unknown; options?: unknown }
    const primera = Array.isArray(options) ? (options[0] as { value?: unknown } | undefined) : undefined
    const opcion = texto(primera?.value)
    if (opcion) out.push({ atributo: texto(name) || ATRIBUTO_DERIVADO, opcion })
  }
  return out
}

function opcionDelNombre(nombre: string, nombrePadre?: string | null): string {
  const n = nombre.trim()
  const p = (nombrePadre ?? "").trim()
  if (p && n.startsWith(p + SEPARADOR)) return n.slice(p.length + SEPARADOR.length).trim()
  const i = n.lastIndexOf(SEPARADOR)
  return i >= 0 ? n.slice(i + SEPARADOR.length).trim() : ""
}

/**
 * La opción de una variante: de `variantAttributes` si Alegra la entregó; si no, el sufijo del
 * nombre ("Modelo / Verde" → Verde); si tampoco, null. Sólo las variantes tienen opción.
 */
export function varianteDeItem(raw: Record<string, unknown>, nombrePadre?: string | null): VarianteOpcion[] | null {
  if (tipoDeItem(raw) !== "variante") return null
  const deAlegra = opcionesDeAtributos(raw)
  if (deAlegra.length > 0) return deAlegra
  const derivada = opcionDelNombre(typeof raw.name === "string" ? raw.name : "", nombrePadre)
  return derivada ? [{ atributo: ATRIBUTO_DERIVADO, opcion: derivada }] : null
}

/**
 * Clave de pareo de la opción: opciones normalizadas (como los códigos), ordenadas y unidas con "|".
 * SIN el nombre del atributo: puede diferir entre cuentas ("Color" vs "Tono"), la opción "Verde" no.
 */
export function claveVariante(v: VarianteOpcion[] | null): string | null {
  if (!v) return null
  const opciones = v.map((o) => normalizarCodigo(o.opcion)).filter(Boolean).sort()
  return opciones.length > 0 ? opciones.join("|") : null
}

/** Texto del selector: la etiqueta manual si hay; si no, las opciones unidas con " / "; si no, null. */
export function etiquetaDe(v: VarianteOpcion[] | null, manual?: string | null): string | null {
  const m = (manual ?? "").trim()
  if (m) return m
  const opciones = (v ?? []).map((o) => o.opcion.trim()).filter(Boolean)
  return opciones.length > 0 ? opciones.join(SEPARADOR) : null
}
