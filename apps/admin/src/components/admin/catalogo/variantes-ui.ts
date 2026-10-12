// Lógica pura de la UI de modelos con variantes del panel de catálogo (change `variantes-de-producto`,
// S4). Vive aparte de los componentes para poder probarla sin navegador: acá no hay React ni fetch.
// Textos en español formal de usted.

import type { ProductoDto, VarianteDto } from "./tipos"

/** Aviso del panel: mientras el selector de la tienda no esté activo, los cambios al modelo no se ven. */
export const AVISO_MODELOS =
  "Los cambios al modelo se verán en la tienda cuando se active el selector de variantes."

/** El padre de Alegra agrupa variantes pero no se compra. */
export const TEXTO_NO_SE_VENDE = "No se vende"
export const AYUDA_NO_SE_VENDE =
  "Es el producto que agrupa las variantes en Alegra: no tiene precio ni stock propios y no se vende. Se vende cada variante."

/** ¿Es un modelo (tiene variantes a mostrar)? */
export const esModelo = (p: Pick<ProductoDto, "esAncla" | "variantes">): boolean => p.esAncla && p.variantes.length > 0

/** "1 variante" / "3 variantes". */
export function textoCantidadVariantes(n: number): string {
  return `${n} ${n === 1 ? "variante" : "variantes"}`
}

/** ¿Está activo en Alegra y visto en la última sincronización? Se usa para contar las que se pueden vender. */
export const estaActiva = (v: Pick<VarianteDto, "status" | "alegraStatus">): boolean =>
  v.status === "active" && v.alegraStatus !== "inactive"

function numeroDePrecio(prices: unknown): number | null {
  if (!Array.isArray(prices)) return null
  const valores = prices
    .map((p) => {
      const crudo = (p as { price?: unknown })?.price
      const n = typeof crudo === "string" ? Number(crudo) : crudo
      return typeof n === "number" && Number.isFinite(n) ? n : 0
    })
    .filter((n) => n > 0)
  return valores.length > 0 ? valores[0] : null
}

export interface ResumenPrecio {
  /** El precio más bajo entre las variantes activas con precio; null si ninguna tiene. */
  minimo: number | null
  /** true = hay precios distintos entre las variantes (se muestra «Desde»). */
  difieren: boolean
}

/** Precio del modelo: el más bajo entre las variantes activas con precio. */
export function resumenPrecio(variantes: Pick<VarianteDto, "prices" | "status" | "alegraStatus">[]): ResumenPrecio {
  const precios = variantes.filter(estaActiva).map((v) => numeroDePrecio(v.prices)).filter((n): n is number => n !== null)
  if (precios.length === 0) return { minimo: null, difieren: false }
  const minimo = Math.min(...precios)
  return { minimo, difieren: precios.some((n) => n !== minimo) }
}

/** Stock total del modelo: suma el de las variantes activas con dato. null si ninguna tiene dato. */
export function stockTotal(variantes: Pick<VarianteDto, "stock" | "status" | "alegraStatus">[]): number | null {
  let total: number | null = null
  for (const v of variantes) {
    if (!estaActiva(v) || v.stock === null) continue
    const n = Number(v.stock)
    if (Number.isFinite(n)) total = (total ?? 0) + n
  }
  return total
}

/** Cuántas variantes están dadas de baja en Alegra. */
export const cantidadInactivas = (variantes: Pick<VarianteDto, "status" | "alegraStatus">[]): number =>
  variantes.filter((v) => !estaActiva(v)).length

/** Nombre corto de una variante para listas y diálogos: su etiqueta, o su código/nombre de Alegra. */
export const nombreDeVariante = (v: Pick<VarianteDto, "etiqueta" | "nombreAlegra" | "code">): string =>
  v.etiqueta?.trim() || v.nombreAlegra || v.code || "Sin nombre"

/** Un producto suelto: se puede sumar a un modelo (no es padre, ni variante, ni está en un grupo). */
export const esSuelto = (p: Pick<ProductoDto, "tipo" | "grupoId" | "esAncla">): boolean =>
  p.tipo === "simple" && p.grupoId === null && !p.esAncla

/**
 * Candidatos al buscar «el producto a sumar»: sólo productos sueltos, sin el modelo de destino.
 * (Los padres, las variantes y lo que ya está en un grupo no se pueden sumar.)
 */
export function candidatosParaSumar(resultados: ProductoDto[], destinoId: string | null): ProductoDto[] {
  return resultados.filter((p) => esSuelto(p) && p.alegraId !== destinoId)
}

/**
 * Candidatos al buscar «el modelo»: un padre, la base de un grupo manual, o un producto suelto (que
 * pasa a ser la base de un grupo nuevo). Se excluye el producto que se está sumando.
 */
export function candidatosDeModelo(resultados: ProductoDto[], productoId: string | null): ProductoDto[] {
  return resultados.filter((p) => p.alegraId !== productoId && (p.tipo === "padre" || p.esAncla || esSuelto(p)))
}

/** Un modelo candidato necesita que se indique la etiqueta de su producto base sólo si es un suelto. */
export const necesitaEtiquetaBase = (modelo: Pick<ProductoDto, "tipo" | "grupoId" | "esAncla">): boolean => esSuelto(modelo)

/** Etiqueta propuesta por defecto para el producto que se suma (el último tramo de su nombre, si lo tiene). */
export function etiquetaSugerida(nombre: string): string {
  const partes = nombre.split(" / ")
  const ultimo = partes.length > 1 ? partes[partes.length - 1].trim() : ""
  return ultimo.slice(0, 60)
}

/** Texto de la confirmación para quitar un producto del modelo. */
export const textoQuitar = (nombre: string): string =>
  `Va a quitar «${nombre}» del modelo. Volverá a mostrarse como un producto propio en la tienda.`
