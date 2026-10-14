// Tienda online de cada empresa (Datos → Tienda online): la marca que muestra el Shop
// (`tenants.shop_marca`, migración 0085) y las direcciones del Shop (`shop_url`,
// `shop_internal_url`, migración 0084). Lo lee el Shop del lado servidor.
//
// Contrato de la marca: src/lib/__fixtures__/marca-contrato.json (casos válidos e inválidos). La
// rebanada 3b copia el fixture al Shop, que vuelve a sanear la columna al leerla: una fila tocada
// a mano no debe romper el sitio.

export const NOMBRE_MAX = 60
export const TITULO_MAX = 80
export const DESCRIPCION_MAX = 200
export const OG_EYEBROW_MAX = 40
export const OG_BAJADA_MAX = 120
export const OG_LUGAR_MAX = 60
export const EMAIL_MAX = 120

export type ShopMarcaBase = "central" | "generica"

export interface ShopMarcaOgTextos {
  eyebrow?: string
  bajada?: string
  lugar?: string
}

/**
 * Marca del tenant. Todas las claves son opcionales: ausente = el Shop usa el valor de partida
 * de su `base` ("central" = los textos de hoy, y es la base si no se indica).
 */
export interface ShopMarca {
  base?: ShopMarcaBase
  nombre?: string
  titulo?: string
  descripcion?: string
  logoUrl?: string
  logoMailUrl?: string
  faviconUrl?: string
  ogImagenUrl?: string
  ogTextos?: ShopMarcaOgTextos
  emailContacto?: string
}

export type Parse<T> = { ok: true; value: T } | { ok: false; error: string; campo: string }

/** Extensiones de imagen permitidas (las mismas que genera `marcaKey`). */
export const EXTENSIONES_MARCA = ["svg", "png", "webp", "jpg"] as const
export type ExtensionMarca = (typeof EXTENSIONES_MARCA)[number]
/** Los clientes de correo no renderizan SVG ni WebP de forma confiable. */
const EXTENSIONES_MAIL: readonly string[] = ["png", "jpg"]

export interface ContextoMedia {
  /** Hostnames desde los que se aceptan imágenes de marca (el bucket público de medios). */
  hosts: string[]
}

/** Contenido permitido por extensión para firmar la subida de un logo. */
export const CONTENT_TYPE_MARCA: Record<ExtensionMarca, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
}

/**
 * Hosts de imágenes permitidos: `SHOP_MEDIA_HOSTS` (lista separada por comas, la misma que usa el
 * Shop) más el host de `R2_SHOP_MEDIA_PUBLIC_URL`, sin repetidos.
 */
export function hostsMedia(env: Record<string, string | undefined> = process.env): string[] {
  const lista = (env.SHOP_MEDIA_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  try {
    const pub = env.R2_SHOP_MEDIA_PUBLIC_URL?.trim()
    if (pub) lista.push(new URL(pub).hostname.toLowerCase())
  } catch {
    // URL pública ilegible: se ignora, no habilita nada.
  }
  return [...new Set(lista)]
}

/** Espacios colapsados y recortados: lo que se ve en pantalla. */
const limpiar = (s: string) => s.replace(/\s+/g, " ").trim()

const falla = (campo: string, error: string): { ok: false; error: string; campo: string } => ({ ok: false, error, campo })

/** Texto opcional: undefined/"" → ausente; no-texto o largo excedido → error. */
function texto(
  entrada: Record<string, unknown>,
  campo: string,
  etiqueta: string,
  max: number,
  errorCampo = campo,
): { ok: true; value: string | undefined } | { ok: false; error: string; campo: string } {
  const v = entrada[campo]
  if (v === undefined || v === null) return { ok: true, value: undefined }
  if (typeof v !== "string") return falla(errorCampo, `${etiqueta} no es válido`)
  const limpio = limpiar(v)
  if (limpio.length > max) return falla(errorCampo, `${etiqueta} admite hasta ${max} caracteres`)
  return { ok: true, value: limpio || undefined }
}

function urlImagen(
  entrada: Record<string, unknown>,
  campo: string,
  etiqueta: string,
  ctx: ContextoMedia,
  extensiones: readonly string[],
): { ok: true; value: string | undefined } | { ok: false; error: string; campo: string } {
  const v = entrada[campo]
  if (v === undefined || v === null) return { ok: true, value: undefined }
  if (typeof v !== "string") return falla(campo, `${etiqueta} no es válido`)
  const crudo = v.trim()
  if (!crudo) return { ok: true, value: undefined }
  if (ctx.hosts.length === 0) {
    return falla(campo, "El almacenamiento de imágenes no está configurado. Avise al administrador.")
  }
  let u: URL
  try {
    u = new URL(crudo)
  } catch {
    return falla(campo, `${etiqueta} debe ser una dirección válida; cárguela con el botón «Subir»`)
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) {
    return falla(campo, `${etiqueta} debe ser una dirección https sin credenciales ni parámetros`)
  }
  if (!ctx.hosts.includes(u.hostname.toLowerCase())) {
    return falla(campo, `${etiqueta} debe estar cargada en el almacenamiento de imágenes de la tienda`)
  }
  const ext = u.pathname.split(".").pop()?.toLowerCase() ?? ""
  if (!u.pathname.includes(".") || !extensiones.includes(ext)) {
    return falla(campo, `${etiqueta} debe ser un archivo ${extensiones.join(", ").toUpperCase()}`)
  }
  return { ok: true, value: u.href }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Valida y normaliza la marca. Descarta claves desconocidas y valores vacíos; nunca devuelve una
 * clave con "" (ausente = default). Errores en usted: se muestran en pantalla.
 */
export function parseShopMarca(raw: unknown, ctx: ContextoMedia): Parse<ShopMarca> {
  if (raw === undefined || raw === null) return { ok: true, value: {} }
  if (typeof raw !== "object" || Array.isArray(raw)) return falla("marca", "La marca de la tienda no es válida")
  const b = raw as Record<string, unknown>
  const out: ShopMarca = {}

  if (b.base !== undefined && b.base !== null && b.base !== "") {
    if (b.base !== "central" && b.base !== "generica") return falla("base", "El tipo de textos de partida no es válido")
    out.base = b.base
  }

  for (const [campo, etiqueta, max] of [
    ["nombre", "El nombre de la tienda", NOMBRE_MAX],
    ["titulo", "El título del sitio", TITULO_MAX],
    ["descripcion", "La descripción", DESCRIPCION_MAX],
  ] as const) {
    const r = texto(b, campo, etiqueta, max)
    if (!r.ok) return r
    if (r.value !== undefined) out[campo] = r.value
  }

  for (const [campo, etiqueta, extensiones] of [
    ["logoUrl", "El logo", EXTENSIONES_MARCA],
    ["logoMailUrl", "El logo para los mails", EXTENSIONES_MAIL],
    ["faviconUrl", "El ícono del sitio", EXTENSIONES_MARCA],
    ["ogImagenUrl", "La imagen para compartir", EXTENSIONES_MARCA],
  ] as const) {
    const r = urlImagen(b, campo, etiqueta, ctx, extensiones)
    if (!r.ok) return r
    if (r.value !== undefined) out[campo] = r.value
  }

  if (b.ogTextos !== undefined && b.ogTextos !== null) {
    if (typeof b.ogTextos !== "object" || Array.isArray(b.ogTextos)) {
      return falla("ogTextos", "Los textos de la imagen para compartir no son válidos")
    }
    const o = b.ogTextos as Record<string, unknown>
    const og: ShopMarcaOgTextos = {}
    for (const [campo, etiqueta, max] of [
      ["eyebrow", "El texto superior de la imagen para compartir", OG_EYEBROW_MAX],
      ["bajada", "La bajada de la imagen para compartir", OG_BAJADA_MAX],
      ["lugar", "El lugar de la imagen para compartir", OG_LUGAR_MAX],
    ] as const) {
      const r = texto(o, campo, etiqueta, max, "ogTextos")
      if (!r.ok) return r
      if (r.value !== undefined) og[campo] = r.value
    }
    if (Object.keys(og).length > 0) out.ogTextos = og
  }

  const mail = texto(b, "emailContacto", "El email de contacto", EMAIL_MAX)
  if (!mail.ok) return mail
  if (mail.value !== undefined) {
    if (!EMAIL_RE.test(mail.value)) return falla("emailContacto", "El email de contacto no es válido")
    out.emailContacto = mail.value
  }

  return { ok: true, value: out }
}

/**
 * Dirección de la tienda (`shop_url` / `shop_internal_url`): https, sin ruta, sin credenciales,
 * sin parámetros. Vacío = el tenant no tiene Shop propio (rige el par histórico de envs).
 * Devuelve el origen normalizado (sin barra final).
 */
export function parseSitio(raw: unknown, campo: "shopUrl" | "shopInternalUrl"): Parse<string> {
  const etiqueta = campo === "shopUrl" ? "La dirección pública de la tienda" : "La dirección interna de la tienda"
  if (raw === undefined || raw === null) return { ok: true, value: "" }
  if (typeof raw !== "string") return falla(campo, `${etiqueta} no es válida`)
  const crudo = raw.trim()
  if (!crudo) return { ok: true, value: "" }
  let u: URL
  try {
    u = new URL(crudo)
  } catch {
    return falla(campo, `${etiqueta} no es válida. Indique la dirección completa, por ejemplo https://tienda.example`)
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) {
    return falla(campo, `${etiqueta} debe comenzar con https:// y no puede incluir ruta, parámetros ni credenciales`)
  }
  return { ok: true, value: u.origin }
}

/** Temas de partida que existen en el Shop (data-theme). El de hoy de Central es "calido-azul". */
export const BASES_TEMA = ["calido-azul", "calido"] as const
export type ShopTemaBase = (typeof BASES_TEMA)[number]

/**
 * Los ocho colores que elige la empresa. El Shop deriva el resto de los tokens (--color-*) a partir
 * de ellos con color-mix. Correspondencia con las variables del Shop (rebanada 4b):
 *   bg → --color-bg · surface → --color-surface · text → --color-text · muted → --color-muted
 *   primary → --color-primary · onPrimary → --color-on-primary · accent → --color-accent
 *   surfaceDark → --color-surface-dark
 */
export const COLORES_TEMA = ["bg", "surface", "text", "muted", "primary", "onPrimary", "accent", "surfaceDark"] as const
export type ColorTema = (typeof COLORES_TEMA)[number]
export type ColoresTema = Record<ColorTema, string>

/** Etiquetas de pantalla de cada color (usted, sin tecnicismos). */
export const ETIQUETAS_COLOR_TEMA: Record<ColorTema, string> = {
  bg: "Fondo de la página",
  surface: "Fondo de las tarjetas",
  text: "Texto",
  muted: "Texto secundario",
  primary: "Color principal (botones y barras)",
  onPrimary: "Texto sobre el color principal",
  accent: "Color de acento",
  surfaceDark: "Fondo del pie de página",
}

/**
 * Tema de la tienda (`tenants.shop_tema`, migración 0086). `{}` = el Shop conserva su tema de
 * hoy. `colores` es todo o nada (los ocho): la paleta se valida entera por contraste.
 */
export interface ShopTema {
  base?: ShopTemaBase
  colores?: ColoresTema
}

const HEX_RE = /^#[0-9a-f]{6}$/i

/** Valida y normaliza el tema (hex en minúsculas). Descarta claves desconocidas y vacíos. */
export function parseShopTema(raw: unknown): Parse<ShopTema> {
  if (raw === undefined || raw === null) return { ok: true, value: {} }
  if (typeof raw !== "object" || Array.isArray(raw)) return falla("tema", "El tema de la tienda no es válido")
  const b = raw as Record<string, unknown>
  const out: ShopTema = {}

  if (b.base !== undefined && b.base !== null && b.base !== "") {
    if (!(BASES_TEMA as readonly unknown[]).includes(b.base)) return falla("temaBase", "El tema de partida no es válido")
    out.base = b.base as ShopTemaBase
  }

  if (b.colores !== undefined && b.colores !== null) {
    if (typeof b.colores !== "object" || Array.isArray(b.colores)) return falla("colores", "Los colores del tema no son válidos")
    const c = b.colores as Record<string, unknown>
    if (Object.keys(c).length > 0) {
      const colores = {} as ColoresTema
      for (const clave of COLORES_TEMA) {
        const v = c[clave]
        if (v === undefined || v === null || v === "") {
          return falla("colores", "Indique los ocho colores del tema; si prefiere los de partida, déjelos todos vacíos")
        }
        if (typeof v !== "string" || !HEX_RE.test(v.trim())) {
          return falla(clave, `${ETIQUETAS_COLOR_TEMA[clave]}: el color debe tener el formato #rrggbb, por ejemplo #1e5aa8`)
        }
        colores[clave] = v.trim().toLowerCase()
      }
      out.colores = colores
    }
  }

  return { ok: true, value: out }
}

export interface TiendaOnline {
  marca: ShopMarca
  shopUrl: string
  shopInternalUrl: string
  /** Ausente = el cuerpo no traía `tema`: no se toca lo guardado. */
  tema?: ShopTema
}

/** Valida el cuerpo completo del PUT. Cuerpo vacío o roto = todo vacío. */
export function parseTiendaOnline(body: unknown, ctx: ContextoMedia): Parse<TiendaOnline> {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>
  const marca = parseShopMarca(b.marca, ctx)
  if (!marca.ok) return marca
  const shopUrl = parseSitio(b.shopUrl, "shopUrl")
  if (!shopUrl.ok) return shopUrl
  const shopInternalUrl = parseSitio(b.shopInternalUrl, "shopInternalUrl")
  if (!shopInternalUrl.ok) return shopInternalUrl
  const value: TiendaOnline = { marca: marca.value, shopUrl: shopUrl.value, shopInternalUrl: shopInternalUrl.value }
  if (b.tema !== undefined) {
    const tema = parseShopTema(b.tema)
    if (!tema.ok) return tema
    value.tema = tema.value
  }
  return { ok: true, value }
}

const CAMPOS_IMAGEN = ["logoUrl", "logoMailUrl", "faviconUrl", "ogImagenUrl"] as const

/**
 * Las imágenes que viven en el bucket público de la tienda (`base`) tienen que estar bajo el
 * prefijo de ESTE tenant (`marca/{tenant}/`): sin esto, un administrador podría apuntar su marca a
 * un logo cargado por otra empresa. Las URLs de otros hosts permitidos (CDN propio) no se tocan.
 */
export function verificarPrefijoMarca(marca: ShopMarca, base: string | null, tenantId: string): Parse<ShopMarca> {
  if (!base) return { ok: true, value: marca }
  const prefijoBucket = `${base.replace(/\/+$/, "")}/`
  const propio = `${prefijoBucket}marca/${tenantId}/`
  for (const campo of CAMPOS_IMAGEN) {
    const url = marca[campo]
    if (url && url.startsWith(prefijoBucket) && !url.startsWith(propio)) {
      return falla(campo, "La imagen debe haberse cargado desde esta página, con el botón «Subir»")
    }
  }
  return { ok: true, value: marca }
}
