// Valores válidos de las columnas "enum" de marketing (espejo de los CHECK de la 0080).
export const CANALES = ["instagram", "google_business"] as const
export const FORMATOS = ["reel", "carrusel", "story", "post", "novedad_google"] as const
export const PUBLICOS = ["profesional", "consumidor", "ambos"] as const
export const TEMAS = ["tecnico", "inspiracion", "producto", "precio_promo", "marca_comunidad"] as const
export const OBJETIVOS = ["alcance", "local", "consulta"] as const
export const PRODUCCIONES = ["auto", "semi", "grabado"] as const

export type Canal = (typeof CANALES)[number]
export type Formato = (typeof FORMATOS)[number]
export type Publico = (typeof PUBLICOS)[number]
export type Tema = (typeof TEMAS)[number]
export type Objetivo = (typeof OBJETIVOS)[number]
export type Produccion = (typeof PRODUCCIONES)[number]

export type BriefGrabacion = { guion: string; tomas: string[]; duracionSeg: number; fechaLimite?: string }

export interface PiezaDto {
  id: string
  canal: Canal
  formato: Formato
  plantilla: string
  contenido: Record<string, unknown>
  caption: string
  hashtags: string[]
  productos: string[]
  musicaId: string | null
  sucursalId: string | null
  campanaId: string | null
  publico: Publico
  tema: Tema
  objetivo: Objetivo
  produccion: Produccion
  briefGrabacion: BriefGrabacion | null
  programadaPara: string | null
  estado: string
  version: number
  renderUrl: string | null
  portadaUrl: string | null
  renderKey: string | null
  portadaKey: string | null
  alertas: { regla: string; mensaje: string; severidad: "alta" | "media"; fuente: "regla" | "ia" | "studio" }[]
  chequeoIa: boolean
  origen: "planificador" | "usuario"
  claimPor: string | null
  permalink: string | null
  publicadaAt: string | null
  createdAt: string
  updatedAt: string
}

export function esUno<T extends readonly string[]>(valores: T, v: unknown): v is T[number] {
  return typeof v === "string" && (valores as readonly string[]).includes(v)
}
