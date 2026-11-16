// Sugerencias para «Crear producto» (change `compras-en-transito`, S4b): campos derivados de lo
// que ya está en el CRM. Funciones PURAS sobre filas del catálogo: la lectura de la base está en
// `compras-producto-sugerencias-repo.ts`. Todo es una SUGERENCIA editable; nada se escribe acá.

export interface FilaCatalogo {
  code: string | null
  name: string
  brand: string | null
  ivaPorcentaje: number | null
  categoryAlegraId: string | null
}

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()

/** Valor más frecuente (empate: el que apareció primero). null si no hay datos. */
export function masFrecuente<T>(valores: (T | null | undefined)[]): T | null {
  const cuenta = new Map<T, number>()
  for (const v of valores) if (v !== null && v !== undefined && (typeof v !== "string" || v !== "")) cuenta.set(v, (cuenta.get(v) ?? 0) + 1)
  let mejor: T | null = null
  let n = 0
  for (const [v, c] of cuenta) {
    if (c > n) {
      mejor = v
      n = c
    }
  }
  return mejor
}

/** Sufijo de una referencia: lo que sigue al último "-" (A-Z0-9, hasta 12), en mayúsculas. */
export function sufijoDeCodigo(code: string | null): string | null {
  if (!code) return null
  const i = code.lastIndexOf("-")
  if (i <= 0 || i === code.length - 1) return null
  const s = code.slice(i + 1).trim().toUpperCase()
  return /^[A-Z0-9]{1,12}$/.test(s) ? s : null
}

/** Sufijo nuevo para una marca sin historia: consonantes iniciales (JADEVER -> JDV), 3 caracteres. */
export function sufijoNuevoDeMarca(marca: string): string {
  const limpia = norm(marca).replace(/[^a-z0-9]/g, "").toUpperCase()
  if (limpia.length <= 3) return limpia
  const consonantes = limpia[0] + limpia.slice(1).replace(/[AEIOU]/g, "")
  return (consonantes.length >= 3 ? consonantes : limpia).slice(0, 3)
}

export interface SugerenciaMarca {
  sufijo: string | null
  /** true = no hay productos de esa marca con sufijo: se propone uno nuevo para revisar. */
  sufijoEsNuevo: boolean
  categoriaId: string | null
  ivaPorcentaje: number | null
}

/** Sufijo, categoría e IVA más frecuentes entre los productos de la marca. */
export function sugerirPorMarca(filas: FilaCatalogo[], marca: string): SugerenciaMarca {
  const m = norm(marca)
  if (!m) return { sufijo: null, sufijoEsNuevo: false, categoriaId: null, ivaPorcentaje: null }
  const deMarca = filas.filter((f) => norm(f.brand) === m)
  const sufijo = masFrecuente(deMarca.map((f) => sufijoDeCodigo(f.code)))
  return {
    sufijo: sufijo ?? sufijoNuevoDeMarca(marca),
    sufijoEsNuevo: sufijo === null,
    categoriaId: masFrecuente(deMarca.map((f) => f.categoryAlegraId)),
    ivaPorcentaje: masFrecuente(deMarca.map((f) => f.ivaPorcentaje)),
  }
}

/**
 * Marca del proveedor: la más frecuente entre los productos de sus compras previas; si no hay
 * compras, la marca cuyo nombre aparece dentro del texto escrito (o del nombre del proveedor).
 */
export function sugerirMarca(marcasDeComprasPrevias: (string | null)[], marcasDelCatalogo: string[], texto: string): string | null {
  const previa = masFrecuente(marcasDeComprasPrevias.map((m) => m?.trim() || null))
  if (previa) return previa
  const t = norm(texto)
  if (!t) return null
  const unicas = [...new Set(marcasDelCatalogo.map((m) => m.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  return unicas.find((m) => t.includes(norm(m))) ?? null
}

/**
 * Nombre según el patrón del catálogo: el nombre NO es el código (la referencia = nombre + "-" +
 * sufijo). Se limpia el texto del operador (espacios, mayúsculas sólo si todo estaba en mayúsculas
 * de más de 3 letras se deja como está) y, si es sólo un código, se avisa con `soloCodigo`.
 */
export function sugerirNombre(texto: string): { nombre: string; soloCodigo: boolean } {
  const nombre = texto.replace(/\s+/g, " ").trim()
  const soloCodigo = nombre !== "" && !/\s/.test(nombre) && /\d/.test(nombre) && /^[A-Za-z0-9._/-]+$/.test(nombre)
  return { nombre, soloCodigo }
}

/** Código del proveedor sugerido desde el texto de la línea: la primera palabra con dígitos. */
export function sugerirCodigo(texto: string): string | null {
  const t = texto.trim()
  if (!t) return null
  if (!/\s/.test(t) && /^[A-Za-z0-9._/-]+$/.test(t)) return t
  return t.split(/\s+/).find((p) => /\d/.test(p) && /^[A-Za-z0-9._/-]+$/.test(p)) ?? null
}
