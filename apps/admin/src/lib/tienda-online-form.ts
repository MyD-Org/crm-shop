// Lógica pura del formulario Datos → Tienda online (components/admin/TiendaOnlineForm.tsx):
// pasar entre lo que guarda la API y los campos de texto del formulario, y elegir la extensión de
// la imagen a subir. Va aparte del componente para poder probarla sin navegador.

import type { ShopMarca, ShopMarcaBase } from "@/lib/tienda-online"

export const CAMPOS_IMAGEN = ["logoUrl", "logoMailUrl", "faviconUrl", "ogImagenUrl"] as const
export type CampoImagen = (typeof CAMPOS_IMAGEN)[number]

export interface FormTiendaOnline {
  base: ShopMarcaBase
  nombre: string
  titulo: string
  descripcion: string
  logoUrl: string
  logoMailUrl: string
  faviconUrl: string
  ogImagenUrl: string
  ogEyebrow: string
  ogBajada: string
  ogLugar: string
  emailContacto: string
  shopUrl: string
  shopInternalUrl: string
}

export interface DatosTiendaOnline {
  marca: ShopMarca
  shopUrl: string
  shopInternalUrl: string
}

export const formVacio = (): FormTiendaOnline => ({
  base: "central",
  nombre: "",
  titulo: "",
  descripcion: "",
  logoUrl: "",
  logoMailUrl: "",
  faviconUrl: "",
  ogImagenUrl: "",
  ogEyebrow: "",
  ogBajada: "",
  ogLugar: "",
  emailContacto: "",
  shopUrl: "",
  shopInternalUrl: "",
})

export function formDesdeDatos(d: DatosTiendaOnline): FormTiendaOnline {
  const m = d?.marca && typeof d.marca === "object" ? d.marca : {}
  return {
    base: m.base ?? "central",
    nombre: m.nombre ?? "",
    titulo: m.titulo ?? "",
    descripcion: m.descripcion ?? "",
    logoUrl: m.logoUrl ?? "",
    logoMailUrl: m.logoMailUrl ?? "",
    faviconUrl: m.faviconUrl ?? "",
    ogImagenUrl: m.ogImagenUrl ?? "",
    ogEyebrow: m.ogTextos?.eyebrow ?? "",
    ogBajada: m.ogTextos?.bajada ?? "",
    ogLugar: m.ogTextos?.lugar ?? "",
    emailContacto: m.emailContacto ?? "",
    shopUrl: d?.shopUrl ?? "",
    shopInternalUrl: d?.shopInternalUrl ?? "",
  }
}

/**
 * Cuerpo del PUT. Sólo viajan los campos con contenido; la `base` se manda únicamente si no es la
 * de partida ("central"), así guardar un formulario intacto deja `shop_marca` en `{}`.
 */
export function construirPayload(f: FormTiendaOnline): DatosTiendaOnline {
  const marca: ShopMarca = {}
  if (f.base !== "central") marca.base = f.base
  for (const campo of ["nombre", "titulo", "descripcion", "logoUrl", "logoMailUrl", "faviconUrl", "ogImagenUrl", "emailContacto"] as const) {
    const v = f[campo].trim()
    if (v) marca[campo] = v
  }
  const og = {
    eyebrow: f.ogEyebrow.trim(),
    bajada: f.ogBajada.trim(),
    lugar: f.ogLugar.trim(),
  }
  const ogTextos = Object.fromEntries(Object.entries(og).filter(([, v]) => v)) as NonNullable<ShopMarca["ogTextos"]>
  if (Object.keys(ogTextos).length > 0) marca.ogTextos = ogTextos
  return { marca, shopUrl: f.shopUrl.trim(), shopInternalUrl: f.shopInternalUrl.trim() }
}

const POR_TIPO: Record<string, "svg" | "png" | "webp" | "jpg"> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
}

/** Extensión (de las permitidas) para subir un archivo, o null si el formato no está permitido. */
export function extensionDeArchivo(nombre: string, tipo: string): "svg" | "png" | "webp" | "jpg" | null {
  const punto = nombre.lastIndexOf(".")
  const porNombre = punto >= 0 ? nombre.slice(punto + 1).toLowerCase() : ""
  if (porNombre === "svg" || porNombre === "png" || porNombre === "webp" || porNombre === "jpg") return porNombre
  if (porNombre === "jpeg") return "jpg"
  return POR_TIPO[tipo] ?? null
}

/** Mensaje para mostrar cuando falla la subida de una imagen. */
export function mensajeSubida(body: { error?: unknown } | null | undefined): string {
  return typeof body?.error === "string" && body.error
    ? body.error
    : "No se pudo subir la imagen. Inténtelo nuevamente."
}
