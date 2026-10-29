// Validación pura de una campaña de precios (spec 2026-10-28-campanias-precios-design.md). Lo que
// depende de la base (choque de fechas, estado actual, fin en el futuro al crear) lo valida
// `campanias-repo.ts` dentro de la transacción. Textos en usted: se muestran tal cual en el admin.

export type AlcanceRegla =
  | { tipo: "producto"; alegraId: string }
  | { tipo: "marca"; marca: string }
  | { tipo: "categoria"; categoriaId: string }

export interface ReglaEntrada {
  alcance: AlcanceRegla
  pct: number
  unidades?: number | null
}

export interface CampaniaEntrada {
  nombre: string
  etiqueta?: string
  /** ISO con offset (p. ej. "2026-11-27T00:00:00-03:00"). */
  inicio: string
  fin: string
  reglas: ReglaEntrada[]
}

export type EstadoCampania = "programada" | "activa" | "terminada"

export const NOMBRE_MAX = 80
export const ETIQUETA_MAX = 24
export const PCT_MAX = 90

/** ISO 8601 con zona explícita (Z u offset): una fecha sin zona se interpretaría en la del servidor. */
const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

function fecha(v: unknown): Date | null {
  if (typeof v !== "string" || !ISO_CON_ZONA.test(v)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "")

function alcanceDe(raw: unknown): AlcanceRegla | null {
  if (!raw || typeof raw !== "object") return null
  const a = raw as Record<string, unknown>
  if (a.tipo === "producto" && texto(a.alegraId)) return { tipo: "producto", alegraId: texto(a.alegraId) }
  if (a.tipo === "marca" && texto(a.marca)) return { tipo: "marca", marca: texto(a.marca).toLowerCase() }
  if (a.tipo === "categoria" && texto(a.categoriaId)) return { tipo: "categoria", categoriaId: texto(a.categoriaId) }
  return null
}

export function claveAlcance(a: AlcanceRegla): string {
  return a.tipo === "producto" ? `producto:${a.alegraId}` : a.tipo === "marca" ? `marca:${a.marca}` : `categoria:${a.categoriaId}`
}

export function validarCampania(e: unknown): { ok: true; valor: CampaniaEntrada } | { ok: false; errores: string[] } {
  const errores: string[] = []
  const agregar = (m: string) => {
    if (!errores.includes(m)) errores.push(m)
  }
  const o = e && typeof e === "object" ? (e as Record<string, unknown>) : {}

  const nombre = texto(o.nombre)
  if (!nombre) agregar("Ingrese un nombre para la campaña.")
  else if (nombre.length > NOMBRE_MAX) agregar(`El nombre admite hasta ${NOMBRE_MAX} caracteres.`)
  const etiqueta = texto(o.etiqueta) || nombre
  if (etiqueta.length > ETIQUETA_MAX) agregar(`La etiqueta admite hasta ${ETIQUETA_MAX} caracteres.`)

  const inicio = fecha(o.inicio)
  const fin = fecha(o.fin)
  if (!inicio) agregar("Indique una fecha de inicio válida.")
  if (!fin) agregar("Indique una fecha de fin válida.")
  if (inicio && fin && fin.getTime() <= inicio.getTime()) agregar("La fecha de fin debe ser posterior al inicio.")

  const reglasRaw = Array.isArray(o.reglas) ? o.reglas : []
  if (reglasRaw.length === 0) agregar("Agregue al menos una regla.")
  const reglas: ReglaEntrada[] = []
  const claves = new Set<string>()
  for (const raw of reglasRaw) {
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
    const alcance = alcanceDe(r.alcance)
    if (!alcance) {
      agregar("Cada regla debe indicar un producto, una marca o una categoría.")
      continue
    }
    const pct = r.pct
    if (typeof pct !== "number" || !Number.isInteger(pct) || pct < 0 || pct > PCT_MAX) {
      agregar(`El descuento debe ser un número entero entre 0 y ${PCT_MAX}.`)
      continue
    }
    let unidades: number | null = null
    if (r.unidades != null) {
      if (alcance.tipo !== "producto") {
        agregar("El límite de unidades sólo se puede indicar en reglas de producto.")
        continue
      }
      if (typeof r.unidades !== "number" || !Number.isInteger(r.unidades) || r.unidades < 1) {
        agregar("El límite de unidades debe ser un número entero mayor que 0.")
        continue
      }
      unidades = r.unidades
    }
    const clave = claveAlcance(alcance)
    if (claves.has(clave)) {
      agregar("Hay reglas repetidas para el mismo producto, marca o categoría.")
      continue
    }
    claves.add(clave)
    reglas.push({ alcance, pct, unidades })
  }

  if (errores.length > 0) return { ok: false, errores }
  return { ok: true, valor: { nombre, etiqueta, inicio: o.inicio as string, fin: o.fin as string, reglas } }
}

/** Programada / activa / terminada por las fechas (fin exclusivo). */
export function estadoCampania(c: { inicio: Date; fin: Date }, ahora: Date): EstadoCampania {
  const t = ahora.getTime()
  if (t < c.inicio.getTime()) return "programada"
  if (t < c.fin.getTime()) return "activa"
  return "terminada"
}
