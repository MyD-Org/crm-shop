/**
 * Lista de impresión de la pantalla de etiquetas: lógica pura (sin DOM ni fetch) para armar filas
 * desde el listado del catálogo, sumar sin duplicar, cantidades por stock de sucursal y el resumen.
 */
import { validarCantidad } from "./texto"
import type { ItemEtiqueta, Omitido } from "./trabajos"

/** Tope de productos que agrega "Agregar todos los de la marca" de una vez. */
export const MAX_PRODUCTOS_LISTA = 1000
export const MENSAJE_TOPE_MARCA = `Se agregaron los primeros ${MAX_PRODUCTOS_LISTA} productos de la marca; hay más sin agregar.`
export const MENSAJE_SIN_REFERENCIA = "Este producto no tiene referencia y se omitirá."

interface StockSucursal {
  sucursal: string
  stock: string
}

/** Lo que usa la pantalla de una fila de GET /api/admin/catalogo/productos. */
export interface ProductoListado {
  alegraId: string
  code: string | null
  nombreEfectivo: string
  stockSucursales: StockSucursal[]
  variantes?: {
    alegraId: string
    code: string | null
    nombreAlegra: string
    etiqueta: string | null
    stockSucursales: StockSucursal[]
  }[]
}

export interface FilaLista {
  alegraId: string
  referencia: string | null
  nombre: string
  /** Texto del input (se valida al imprimir o al perder el foco). */
  cantidad: string
  /** Stock por slug de sucursal (sólo las sucursales con dato). */
  stock: Record<string, number>
  /** La cantidad salió del stock de una sucursal y ese stock era 0 o negativo (se imprime 1). */
  sinStock?: boolean
}

const mapaStock = (s: StockSucursal[]): Record<string, number> => {
  const m: Record<string, number> = {}
  for (const { sucursal, stock } of s) {
    const n = Number(stock)
    if (Number.isFinite(n)) m[sucursal] = n
  }
  return m
}

/**
 * Filas de un producto del listado. Un modelo (ancla con variantes) se imprime por variante: cada
 * una tiene su referencia y su ficha; el ancla de Alegra no se vende.
 */
export function filasDeProducto(p: ProductoListado): FilaLista[] {
  if (p.variantes && p.variantes.length > 0) {
    return p.variantes.map((v) => ({
      alegraId: v.alegraId,
      referencia: v.code,
      nombre: v.etiqueta ? `${p.nombreEfectivo} ${v.etiqueta}` : v.nombreAlegra,
      cantidad: "1",
      stock: mapaStock(v.stockSucursales),
    }))
  }
  return [{ alegraId: p.alegraId, referencia: p.code, nombre: p.nombreEfectivo, cantidad: "1", stock: mapaStock(p.stockSucursales) }]
}

/** Suma al final las filas que no estén ya (por alegraId); devuelve cuántas entraron. */
export function agregarSinDuplicar(lista: FilaLista[], nuevas: FilaLista[]): { lista: FilaLista[]; agregadas: number } {
  const presentes = new Set(lista.map((f) => f.alegraId))
  const extra: FilaLista[] = []
  for (const f of nuevas) {
    if (presentes.has(f.alegraId)) continue
    presentes.add(f.alegraId)
    extra.push(f)
  }
  return { lista: extra.length ? [...lista, ...extra] : lista, agregadas: extra.length }
}

/** Cantidad a partir del stock: redondeado, mínimo 1 (stock 0, negativo o sin dato cuenta 1 y se marca). */
export function cantidadPorStock(stock: number | undefined): { cantidad: number; sinStock: boolean } {
  const n = stock === undefined ? 0 : Math.round(stock)
  if (n < 1) return { cantidad: 1, sinStock: true }
  return { cantidad: Math.min(n, 999), sinStock: false }
}

/** `slug` = usar el stock de esa sucursal; null = volver a la carga manual (se conservan las cantidades). */
export function aplicarStockSucursal(lista: FilaLista[], slug: string | null): FilaLista[] {
  if (slug === null) return lista.map((f) => ({ ...f, sinStock: undefined }))
  return lista.map((f) => {
    const { cantidad, sinStock } = cantidadPorStock(f.stock[slug])
    return { ...f, cantidad: String(cantidad), sinStock }
  })
}

/** Ítems para los trabajos; las filas con cantidad inválida se devuelven aparte y no se imprimen. */
export function itemsDeLista(lista: FilaLista[]): { items: ItemEtiqueta[]; invalidas: string[] } {
  const items: ItemEtiqueta[] = []
  const invalidas: string[] = []
  for (const f of lista) {
    if (!validarCantidad(f.cantidad).ok) {
      invalidas.push(f.alegraId)
      continue
    }
    items.push({ alegraId: f.alegraId, referencia: f.referencia, nombre: f.nombre, cantidad: Number(f.cantidad) })
  }
  return { items, invalidas }
}

export function mensajeEnviadas(n: number): string {
  return n === 1 ? "Se envió 1 etiqueta a la impresora." : `Se enviaron ${n} etiquetas a la impresora.`
}

export function tituloOmitidos(omitidos: Omitido[]): string {
  return omitidos.length === 1 ? "Se omitió 1 producto:" : `Se omitieron ${omitidos.length} productos:`
}
