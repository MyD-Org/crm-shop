// Etiquetas ("chips") de un medio de pago: texto corto y tono que el Shop muestra resaltado sobre la
// opción de ese medio en el checkout. Validación pura (sin DB ni Next): la comparten la API y el
// editor de la tarjeta. Mensajes en usted. En la base es `medios_pago_shop.chips jsonb` (0071); el
// CHECK de la base sólo exige que sea un array: la validación fina vive acá.

export const MAX_CHIPS = 3
export const MAX_TEXTO_CHIP = 40
export const TONOS_CHIP = ["destacado", "exito", "info"] as const
export type TonoChip = (typeof TONOS_CHIP)[number]

export interface ChipMedio {
  texto: string
  tono: TonoChip
}

/** Etiqueta de cada tono para el selector del editor. */
export const ETIQUETA_TONO_CHIP: Record<TonoChip, string> = {
  destacado: "Destacado",
  exito: "Éxito",
  info: "Informativo",
}

/** Tono del Badge del DS con el que se dibuja cada tono (el DS no tiene un tono de acento propio). */
export const TONO_BADGE_DE_CHIP: Record<TonoChip, "warning" | "success" | "info"> = {
  destacado: "warning",
  exito: "success",
  info: "info",
}

/** Mueve el elemento `i` una posición (-1 sube, 1 baja); fuera de rango no cambia nada. Devuelve una copia. */
export function moverChip<T>(chips: readonly T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta
  const copia = chips.slice()
  if (i < 0 || i >= chips.length || j < 0 || j >= chips.length) return copia
  ;[copia[i], copia[j]] = [copia[j], copia[i]]
  return copia
}

export const MSG_CHIPS_MAX = `Cada medio de pago admite hasta ${MAX_CHIPS} etiquetas.`
export const MSG_CHIP_VACIO = "Ingrese el texto de la etiqueta."
export const MSG_CHIP_LARGO = `El texto de la etiqueta admite hasta ${MAX_TEXTO_CHIP} caracteres.`
export const MSG_CHIP_CARACTERES = "El texto de la etiqueta no puede incluir signos < o > ni saltos de línea."
export const MSG_CHIP_TONO = "Seleccione el tono de la etiqueta."
export const MSG_CHIPS_FORMATO = "Las etiquetas indicadas no son válidas."

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const esTono = (v: unknown): v is TonoChip => (TONOS_CHIP as readonly unknown[]).includes(v)
// Sin HTML (< >) ni caracteres de control (saltos de línea, tabulaciones).
const CARACTERES_PROHIBIDOS = /[<>\u0000-\u001f\u007f]/

/**
 * Banner de ahorro del medio (la franja verde del checkout, «Ahorra $X frente a …»). Se guarda como
 * un elemento más de `chips` con `banner: true` (sin migración); el Shop lo lee aparte y las lecturas
 * de etiquetas lo ignoran (no tiene `tono`). En el texto, `{ahorro}` es el monto y `{frente}` la
 * opción más cara. Sin banner guardado: Transferencia lo muestra con `TEXTO_BANNER_POR_DEFECTO`.
 */
export interface BannerMedio {
  banner: true
  activo: boolean
  texto: string
}

export const MAX_TEXTO_BANNER = 80
export const TEXTO_BANNER_POR_DEFECTO = "Ahorra {ahorro} frente a {frente}"
export const MSG_BANNER_VACIO = "Ingrese el texto del banner."
export const MSG_BANNER_LARGO = `El texto del banner admite hasta ${MAX_TEXTO_BANNER} caracteres.`
export const MSG_BANNER_CARACTERES = "El texto del banner no puede incluir signos < o > ni saltos de línea."

/** Lo que se guarda en `chips`: las etiquetas y, a lo sumo, un banner. */
export type ElementoChips = ChipMedio | BannerMedio

const esBanner = (c: unknown): boolean => esObjeto(c) && c.banner === true

export type ResultadoChips = { ok: true; chips: ElementoChips[] } | { ok: false; error: string }

/** Valida (y normaliza: recorta el texto) la lista de chips que llega del admin. */
export function validarChips(entrada: unknown): ResultadoChips {
  if (!Array.isArray(entrada)) return { ok: false, error: MSG_CHIPS_FORMATO }
  const banners = entrada.filter(esBanner)
  if (banners.length > 1) return { ok: false, error: MSG_CHIPS_FORMATO }
  const etiquetas = entrada.filter((c) => !esBanner(c))
  if (etiquetas.length > MAX_CHIPS) return { ok: false, error: MSG_CHIPS_MAX }
  const chips: ElementoChips[] = []
  for (const b of banners as Record<string, unknown>[]) {
    if (typeof b.texto !== "string" || typeof b.activo !== "boolean") return { ok: false, error: MSG_CHIPS_FORMATO }
    const texto = b.texto.trim()
    if (texto === "") return { ok: false, error: MSG_BANNER_VACIO }
    if (CARACTERES_PROHIBIDOS.test(texto)) return { ok: false, error: MSG_BANNER_CARACTERES }
    if (texto.length > MAX_TEXTO_BANNER) return { ok: false, error: MSG_BANNER_LARGO }
    chips.push({ banner: true, activo: b.activo, texto })
  }
  for (const c of etiquetas) {
    if (!esObjeto(c) || typeof c.texto !== "string") return { ok: false, error: MSG_CHIPS_FORMATO }
    const texto = c.texto.trim()
    if (texto === "") return { ok: false, error: MSG_CHIP_VACIO }
    if (CARACTERES_PROHIBIDOS.test(texto)) return { ok: false, error: MSG_CHIP_CARACTERES }
    if (texto.length > MAX_TEXTO_CHIP) return { ok: false, error: MSG_CHIP_LARGO }
    if (!esTono(c.tono)) return { ok: false, error: MSG_CHIP_TONO }
    chips.push({ texto, tono: c.tono })
  }
  return { ok: true, chips }
}

/**
 * Lectura TOLERANTE de lo que guarda la base: nunca tira. Lo que no es una lista da [], los chips
 * mal formados se descartan y se conservan a lo sumo los primeros `MAX_CHIPS` buenos.
 */
export function leerChips(valor: unknown): ChipMedio[] {
  if (!Array.isArray(valor)) return []
  const buenos: ChipMedio[] = []
  for (const c of valor) {
    if (buenos.length >= MAX_CHIPS) break
    if (!esObjeto(c) || esBanner(c) || typeof c.texto !== "string" || !esTono(c.tono)) continue
    const texto = c.texto.trim()
    if (texto === "" || CARACTERES_PROHIBIDOS.test(texto) || texto.length > MAX_TEXTO_CHIP) continue
    buenos.push({ texto, tono: c.tono })
  }
  return buenos
}

/** Lectura tolerante del banner guardado en `chips`; null = no hay (rige el comportamiento por defecto). */
export function leerBanner(valor: unknown): BannerMedio | null {
  if (!Array.isArray(valor)) return null
  const b = valor.find(esBanner) as Record<string, unknown> | undefined
  if (!b || typeof b.texto !== "string" || typeof b.activo !== "boolean") return null
  const texto = b.texto.trim()
  if (texto === "" || CARACTERES_PROHIBIDOS.test(texto) || texto.length > MAX_TEXTO_BANNER) return null
  return { banner: true, activo: b.activo, texto }
}

/** Banner a mostrar en el editor: el guardado o, si no hay, el de por defecto (prendido sólo en Transferencia). */
export function bannerDelMedio(slug: string, guardado: BannerMedio | null | undefined): BannerMedio {
  return guardado ?? { banner: true, activo: slug === "transferencia", texto: TEXTO_BANNER_POR_DEFECTO }
}
