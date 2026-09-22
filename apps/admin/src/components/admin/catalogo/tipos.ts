// Tipos y helpers compartidos por el panel de catálogo. El cliente habla SIEMPRE con
// /api/admin/catalogo/*: no hay ninguna consulta a la base desde el navegador, y el filtrado, el
// conteo y el paginado los resuelve Postgres (con ~5959 productos no hay otra opción).

import type { MotivoNoPublicado } from "@/lib/catalogo-overlay"

/**
 * Por qué un producto no se publica, en español formal de usted. Vive acá y no en el módulo de
 * dominio porque es presentación: importar el dominio desde un componente cliente arrastraría
 * drizzle al bundle del navegador.
 */
export const TEXTO_MOTIVO: Record<MotivoNoPublicado, string> = {
  oculto: "Está oculto en la tienda. Puede publicarlo desde acá.",
  inactivo_en_alegra: "Alegra lo marcó inactivo. Mientras siga así, publicarlo no lo muestra en la tienda.",
  sin_precio: "No tiene precio en Alegra.",
}

/** El admin SÍ recibe la url ya compuesta: es lo único que necesita para mostrarla. */
export interface FotoDto {
  key: string
  url: string | null
  w: number
  alt?: string
}

export interface ProductoDto {
  alegraId: string
  code: string | null
  nombreAlegra: string
  descripcionAlegra: string | null
  status: string
  prices: unknown
  stock: string | null
  syncedAt: string | null
  nombre: string | null
  descripcion: string | null
  nombreEfectivo: string
  sku: string
  visible: boolean
  categoriaId: string | null
  categoriaNombre: string | null
  orden: number | null
  tagIds: string[]
  fotos: FotoDto[]
  actualizadoEn: string | null
  motivos: MotivoNoPublicado[]
}

export interface CategoriaDto {
  id: string
  parentId: string | null
  nombre: string
  slug: string
  orden: number
  nivel: number
  activa: boolean
  productos: number
  /** KEY del objeto en R2; la url viene compuesta por el servidor. */
  imagenKey: string | null
  imagenUrl: string | null
}

export interface TagDto {
  id: string
  nombre: string
  slug: string
  productos: number
}

export interface Sincronizacion {
  /** Última corrida OK de la sync con Alegra. */
  alegra: string | null
  /** Último AVISO entregado a la tienda, no su sincronización (ver el rótulo en la UI). */
  avisoShop: { ultimoOkAt: string | null; ultimoIntentoAt: string | null }
}

export interface ListadoDto {
  items: ProductoDto[]
  total: number
  start: number
  limit: number
  sincronizacion: Sincronizacion
}

/** Los filtros tal cual viajan por query string y dentro del descriptor de una masiva. */
export interface Filtros {
  q?: string
  categoria?: string
  estado?: "visible" | "oculto"
  foto?: "con" | "sin"
  nombre?: "sin"
  alegra?: "active" | "inactive"
  precio?: "con" | "sin"
  stock?: "con" | "sin"
  tag?: string
}

export type Seleccion =
  | { tipo: "ids"; alegraIds: string[] }
  | { tipo: "filtro"; filtros: Filtros; excluir?: string[] }

export const queryDeFiltros = (filtros: Filtros): URLSearchParams => {
  const p = new URLSearchParams()
  for (const [clave, valor] of Object.entries(filtros)) {
    if (typeof valor === "string" && valor !== "") p.set(clave, valor)
  }
  return p
}

export class ErrorApi extends Error {
  constructor(
    message: string,
    readonly campo?: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

/**
 * Un fetch del panel. Devuelve el cuerpo ya parseado o tira un ErrorApi con el mensaje que el
 * servidor mandó — que ya viene en español formal de usted y sin detalles internos, así que se
 * muestra tal cual.
 */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      cache: "no-store",
      ...init,
      ...(init?.body !== undefined ? { headers: { "content-type": "application/json" } } : {}),
    })
  } catch {
    throw new ErrorApi("No pudimos conectarnos. Revise su conexión e inténtelo nuevamente.")
  }
  const cuerpo = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    const mensaje = typeof cuerpo?.error === "string" ? cuerpo.error : "No pudimos completar la operación. Inténtelo nuevamente."
    throw new ErrorApi(mensaje, cuerpo?.campo as string | undefined, cuerpo?.code as string | undefined)
  }
  return cuerpo as T
}

/**
 * "20/09/2026, 14:05" o "Desconocida": nunca una fecha inventada ni un vacío.
 * La zona horaria va explícita: sin ella, el servidor formatea en UTC y el navegador en local, y
 * eso ya produjo un desajuste de hidratación en el inbox.
 */
export function fmtFechaHora(iso: string | null): string {
  if (!iso) return "Desconocida"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "Desconocida"
  return d.toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** El primer precio de lista mayor a cero, formateado. null si no tiene ninguno. */
export function precioDeLista(prices: unknown): string | null {
  if (!Array.isArray(prices)) return null
  const valores = prices
    .map((p) => {
      const crudo = (p as { price?: unknown })?.price
      const n = typeof crudo === "string" ? Number(crudo) : crudo
      return typeof n === "number" && Number.isFinite(n) ? n : 0
    })
    .filter((n) => n > 0)
  if (valores.length === 0) return null
  return valores[0].toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 })
}
