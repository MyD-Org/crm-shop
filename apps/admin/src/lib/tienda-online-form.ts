// Lógica pura del formulario Datos → Tienda online (components/admin/TiendaOnlineForm.tsx):
// pasar entre lo que guarda la API y los campos de texto del formulario, y elegir la extensión de
// la imagen a subir. Va aparte del componente para poder probarla sin navegador.

import partida from "@/lib/__fixtures__/marca-partida.json"
import { contrasteTema, UMBRAL_CONTRASTE, validarContrasteTema } from "@/lib/tema-contraste"
import { COLORES_TEMA, type ColoresTema, type ShopMarca, type ShopMarcaBase, type ShopTema, type ShopTemaBase } from "@/lib/tienda-online"

/**
 * Paletas de los temas de partida del Shop (los valores de globals.css del Shop). Sirven para
 * precargar los selectores al activar «Personalizar colores». Mismo contenido que el fixture
 * compartido (tema-contrato.json), con test.
 */
export const PALETAS_TEMA: Record<ShopTemaBase, ColoresTema> = {
  "calido-azul": { bg: "#f8f8f6", surface: "#ffffff", text: "#1c2733", muted: "#5f6770", primary: "#16283f", onPrimary: "#eaf1f8", accent: "#1e5aa8", surfaceDark: "#1c2733" },
  calido: { bg: "#faf6ef", surface: "#fffdf8", text: "#2a2118", muted: "#70665a", primary: "#241c14", onPrimary: "#f2e8d8", accent: "#b45f2e", surfaceDark: "#2a2118" },
}
export const TEMA_BASE_PARTIDA: ShopTemaBase = "calido-azul"

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
  /** ¿La empresa elige sus propios colores? Si no, el Shop usa los del tema de partida. */
  temaPropio: boolean
  temaBase: ShopTemaBase
  colores: ColoresTema
}

export interface DatosTiendaOnline {
  marca: ShopMarca
  shopUrl: string
  shopInternalUrl: string
  tema?: ShopTema
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
  temaPropio: false,
  temaBase: TEMA_BASE_PARTIDA,
  colores: { ...PALETAS_TEMA[TEMA_BASE_PARTIDA] },
})

export function formDesdeDatos(d: DatosTiendaOnline): FormTiendaOnline {
  const m = d?.marca && typeof d.marca === "object" ? d.marca : {}
  const t = d?.tema && typeof d.tema === "object" ? d.tema : {}
  const temaBase = t.base ?? TEMA_BASE_PARTIDA
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
    temaPropio: Boolean(t.colores),
    temaBase,
    colores: { ...(t.colores ?? PALETAS_TEMA[temaBase]) },
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
  // `tema` viaja siempre: `{}` restablece el tema de partida (desactivar «Personalizar colores»).
  const tema: ShopTema = {}
  if (f.temaBase !== TEMA_BASE_PARTIDA) tema.base = f.temaBase
  if (f.temaPropio) {
    tema.colores = Object.fromEntries(COLORES_TEMA.map((c) => [c, f.colores[c].trim()])) as ColoresTema
  }
  return { marca, shopUrl: f.shopUrl.trim(), shopInternalUrl: f.shopInternalUrl.trim(), tema }
}

const HEX_COMPLETO = /^#[0-9a-f]{6}$/i

/**
 * Aviso de contraste en vivo para la vista previa del formulario (el servidor lo vuelve a validar
 * al guardar). null = no se personalizan los colores, alguno todavía no es un hex completo, o la
 * paleta es legible.
 */
export function avisoContrasteForm(f: FormTiendaOnline): { campo: string; error: string } | null {
  if (!f.temaPropio) return null
  const colores = {} as ColoresTema
  for (const c of COLORES_TEMA) {
    const v = f.colores[c].trim()
    if (!HEX_COMPLETO.test(v)) return null
    colores[c] = v.toLowerCase()
  }
  const r = validarContrasteTema(colores)
  return r.ok ? null : { campo: r.campo, error: r.error }
}

/** Razones de contraste de la paleta (para mostrarlas junto a la vista previa), o null si hay hex incompletos. */
export function razonesContrasteForm(f: FormTiendaOnline): { campo: string; descripcion: string; razon: number; ok: boolean }[] | null {
  const colores = {} as ColoresTema
  for (const c of COLORES_TEMA) {
    const v = f.colores[c].trim()
    if (!HEX_COMPLETO.test(v)) return null
    colores[c] = v.toLowerCase()
  }
  return contrasteTema(colores).map((p) => ({ ...p, ok: p.razon >= UMBRAL_CONTRASTE }))
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

export interface PlaceholdersMarca {
  nombre: string
  titulo: string
  descripcion: string
  ogEyebrow: string
  ogBajada: string
  ogLugar: string
  emailContacto: string
  /** El valor en uso de algún campo depende de una variable de entorno del Shop que el admin no conoce. */
  dependeDelEntorno: boolean
}

/**
 * Valor en uso de cada texto de marca cuando su campo está vacío, según la base elegida (mismo
 * cálculo que `resolverMarca` del Shop; los textos vienen del fixture compartido marca-partida.json).
 * Vacío = no hay valor de partida que el admin conozca. `nombre` es el nombre ya cargado, si lo hay.
 */
export function placeholdersMarca(base: ShopMarcaBase, nombre: string): PlaceholdersMarca {
  const n = nombre.replace(/\s+/g, " ").trim()
  if (base === "central") {
    const c = partida.central
    const cambia = n !== "" && n !== c.nombre
    return {
      nombre: c.nombre,
      titulo: cambia ? c.tituloConNombre.replace("{nombre}", n) : c.titulo,
      descripcion: c.descripcion,
      ogEyebrow: c.ogTextos.eyebrow,
      ogBajada: c.ogTextos.bajada,
      ogLugar: c.ogTextos.lugar,
      emailContacto: "",
      dependeDelEntorno: false,
    }
  }
  const g = partida.generica
  return {
    // Sin nombre cargado, el de partida sale de una variable del Shop: no se inventa.
    nombre: "",
    titulo: n ? g.tituloConNombre.replace("{nombre}", n) : "",
    descripcion: n ? g.descripcionConNombre.replace("{nombre}", n) : "",
    ogEyebrow: g.ogTextos.eyebrow,
    ogBajada: g.ogTextos.bajada,
    ogLugar: g.ogTextos.lugar,
    emailContacto: "",
    dependeDelEntorno: true,
  }
}
