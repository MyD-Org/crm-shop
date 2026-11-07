// A qué Shop va el ping de revalidación (y qué URL pública se enlaza) para un tenant.
// Módulo PURO: recibe la fila y el env; no lee ni la base ni process.env.
//
// Reglas (change `shop-para-avantec`, D2):
//   1. Tenant con URL propia en `tenants` (shop_internal_url o shop_url): el secreto sale SOLO de
//      `SHOP_CRM_SECRET_<SLUG>`. Si falta, no hay destino: jamás se cae al `SHOP_CRM_SECRET` sin
//      sufijo, porque eso mandaría el secreto de un Shop a la URL de otro.
//   2. Tenant sin URL propia: par histórico (SHOP_INTERNAL_URL + SHOP_CRM_SECRET /
//      NEXT_PUBLIC_SHOP_URL), pero SOLO si `SHOP_TENANT_LEGACY` está sin definir (comportamiento de
//      siempre) o es igual al tenant. Con `SHOP_TENANT_LEGACY=<slug>` el par histórico queda atado
//      a ese tenant y los demás no lo reciben.
//   3. Cualquier otro caso: null (no-op, `propagado:false`, igual que "sin Shop").
//
// Destinos extra (change `dominios-clerk-por-host`, 0099): un tenant con URL propia puede declarar
// hasta MAX_DESTINOS_EXTRA Shops más (mismo código, otro dominio). El principal sigue siendo
// `shop_url`/`shop_internal_url`. Cada extra lleva SU secreto, `SHOP_CRM_SECRET_<TENANT>__<ETIQUETA>`,
// y jamás cae al del principal, al sin sufijo ni al de otro extra.

export interface FilaShop {
  shopUrl: string
  shopInternalUrl: string
  /**
   * Destinos adicionales (`tenants.shop_destinos_extra`, 0099). Llega SIN validar (viene de un
   * jsonb): pasa por `parsearDestinosExtra` antes de usarse. Opcional para no tocar a quien
   * arma una fila a mano.
   */
  shopDestinosExtra?: unknown
}

export interface DestinoShop {
  /** Base a la que se manda el ping; null = no configurada. */
  urlInterna: string | null
  /** URL pública para enlaces; null = no configurada. */
  urlPublica: string | null
  /** Bearer del ping; null = no configurado. */
  secret: string | null
}

export type EnvShop = Readonly<Record<string, string | undefined>>

/** `central-led` → `CENTRAL_LED` (misma regla que las credenciales de MP por sucursal). */
export function slugEnvTenant(tenantId: string): string {
  return tenantId.toUpperCase().replace(/-/g, "_")
}

function limpio(v: string | undefined | null): string {
  return (v ?? "").trim()
}

function sinBarraFinal(url: string): string {
  return url.replace(/\/+$/, "")
}

function urlONull(v: string | undefined | null): string | null {
  const s = limpio(v)
  return s ? sinBarraFinal(s) : null
}

function tieneUrlPropia(fila: FilaShop): boolean {
  return limpio(fila.shopUrl) !== "" || limpio(fila.shopInternalUrl) !== ""
}

/** El par histórico de envs vale para este tenant (legacy sin definir o igual al tenant). */
function legacyAplica(tenantId: string, env: EnvShop): boolean {
  const legacy = limpio(env.SHOP_TENANT_LEGACY)
  return legacy === "" || legacy === tenantId
}

/** URL pública del Shop del tenant para enlaces. No depende del secreto. */
export function urlPublicaShop(tenantId: string, fila: FilaShop, env: EnvShop): string | null {
  if (tieneUrlPropia(fila)) return urlONull(fila.shopUrl)
  return legacyAplica(tenantId, env) ? urlONull(env.NEXT_PUBLIC_SHOP_URL) : null
}

export function resolverDestinoShop(tenantId: string, fila: FilaShop, env: EnvShop): DestinoShop | null {
  if (tieneUrlPropia(fila)) {
    const nombre = `SHOP_CRM_SECRET_${slugEnvTenant(tenantId)}`
    const secret = limpio(env[nombre])
    if (!secret) {
      console.warn(`[shop-destino] el tenant ${tenantId} tiene URL de Shop propia pero falta ${nombre}: no se avisa al Shop`)
      return null
    }
    return {
      urlInterna: urlONull(fila.shopInternalUrl) ?? urlONull(fila.shopUrl),
      urlPublica: urlONull(fila.shopUrl),
      secret,
    }
  }

  if (!legacyAplica(tenantId, env)) return null
  return {
    urlInterna: urlONull(env.SHOP_INTERNAL_URL),
    urlPublica: urlONull(env.NEXT_PUBLIC_SHOP_URL),
    secret: limpio(env.SHOP_CRM_SECRET) || null,
  }
}

/** Atajo para quien ya tiene el tenant cargado (portal, mails, agente): su URL pública del Shop. */
export function urlPublicaShopDeTenant(
  tenant: { id: string; shopUrl?: string; shopInternalUrl?: string },
  env: EnvShop,
): string | null {
  return urlPublicaShop(tenant.id, { shopUrl: tenant.shopUrl ?? "", shopInternalUrl: tenant.shopInternalUrl ?? "" }, env)
}

// ---------------------------------------------------------------------------------------------
// Destinos extra
// ---------------------------------------------------------------------------------------------

export const MAX_DESTINOS_EXTRA = 4
const ETIQUETA_PRINCIPAL = "principal"
const ETIQUETA_MAX = 24
const ETIQUETA_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export interface DestinoExtra {
  etiqueta: string
  /** Origin público (https). */
  url: string
  /** Origin al que va el ping; por defecto, `url`. */
  urlInterna: string
  /**
   * Marca propia del sitio (change `marca-por-dominio`): misma forma que `tenants.shop_marca`.
   * Ausente = el sitio es un alias del principal. Llega sin validar el contenido: el admin la valida
   * al guardar (`parseShopMarca`) y el Shop la vuelve a sanear al leerla.
   */
  marca?: Record<string, unknown>
  /** Tema propio del sitio: misma forma que `tenants.shop_tema`. Ausente = el del principal. */
  tema?: Record<string, unknown>
  /** Dirección desde la que salen los mails de los pedidos hechos en este sitio. */
  remitente?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function objetoPlano(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Marca, tema y remitente del destino: lo inválido se ignora sin descartar el destino (el ping sigue). */
function marcaDelDestino(obj: Record<string, unknown>, nombre: string): Pick<DestinoExtra, "marca" | "tema" | "remitente"> {
  const out: Pick<DestinoExtra, "marca" | "tema" | "remitente"> = {}
  const marca = objetoPlano(obj.marca)
  if (marca) out.marca = marca
  const tema = objetoPlano(obj.tema)
  if (tema) out.tema = tema
  if (typeof obj.remitente === "string" && obj.remitente.trim() !== "") {
    const r = obj.remitente.trim()
    if (EMAIL_RE.test(r)) out.remitente = r
    else console.warn(`[shop-destino] el remitente del destino extra "${nombre}" no es un email: se ignora`)
  }
  return out
}

export interface DestinoShopEtiquetado extends DestinoShop {
  /** "principal" o la etiqueta del extra. */
  etiqueta: string
}

export interface ResolucionDestinos {
  destinos: DestinoShopEtiquetado[]
  /** Etiquetas configuradas pero inutilizables (sin secreto, URL inválida, descartadas). */
  omitidos: string[]
}

function esHostLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost")
}

/** Origin normalizado (https; http solo en localhost; sin credenciales) o null. */
function origenSeguro(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null
  let u: URL
  try {
    u = new URL(v.trim())
  } catch {
    return null
  }
  if (u.username || u.password) return null
  if (u.protocol === "https:") return u.origin
  if (u.protocol === "http:" && esHostLocal(u.hostname)) return u.origin
  return null
}

/**
 * Valida el jsonb `shop_destinos_extra` (NO se confía en la base). Puro y sin tirar: un ítem inválido
 * se descarta solo y su etiqueta (o `#<idx>`) va a `descartados`. `urlsOcupadas` son las URLs del
 * principal: un extra con el mismo origin se descarta.
 */
export function parsearDestinosExtra(
  raw: unknown,
  urlsOcupadas: readonly (string | null | undefined)[] = [],
): { validos: DestinoExtra[]; descartados: string[] } {
  const validos: DestinoExtra[] = []
  const descartados: string[] = []
  if (!Array.isArray(raw)) {
    if (raw !== null && raw !== undefined) console.warn("[shop-destino] shop_destinos_extra no es una lista: se ignora")
    return { validos, descartados }
  }
  const etiquetas = new Set<string>()
  const origenes = new Set<string>()
  for (const o of urlsOcupadas) {
    const origen = origenSeguro(o)
    if (origen) origenes.add(origen)
  }
  raw.forEach((it, idx) => {
    const obj = typeof it === "object" && it !== null && !Array.isArray(it) ? (it as Record<string, unknown>) : null
    const etiqueta = typeof obj?.etiqueta === "string" ? obj.etiqueta : ""
    const nombre = etiqueta || `#${idx}`
    const interna = obj?.urlInterna
    const hayInterna = typeof interna === "string" && interna.trim() !== ""
    const url = origenSeguro(obj?.url)
    const urlInterna = hayInterna ? origenSeguro(interna) : url
    const valido =
      obj !== null &&
      ETIQUETA_RE.test(etiqueta) &&
      etiqueta.length <= ETIQUETA_MAX &&
      etiqueta !== ETIQUETA_PRINCIPAL &&
      !etiquetas.has(etiqueta) &&
      url !== null &&
      urlInterna !== null &&
      !origenes.has(url) &&
      validos.length < MAX_DESTINOS_EXTRA
    if (!valido || url === null || urlInterna === null) {
      descartados.push(nombre)
      console.warn(`[shop-destino] destino extra "${nombre}" descartado por configuración inválida`)
      return
    }
    etiquetas.add(etiqueta)
    origenes.add(url)
    validos.push({ etiqueta, url, urlInterna, ...marcaDelDestino(obj, etiqueta) })
  })
  return { validos, descartados }
}

/** Nombre de la env con el secreto de un destino extra (solo el NOMBRE; el valor nunca se loguea). */
export function nombreSecretoExtra(tenantId: string, etiqueta: string): string {
  return `SHOP_CRM_SECRET_${slugEnvTenant(tenantId)}__${slugEnvTenant(etiqueta)}`
}

/**
 * Principal + extras utilizables. El principal es exactamente `resolverDestinoShop` (etiqueta
 * "principal"). Los extras rigen solo si el principal tiene URL propia. Un extra sin secreto va a
 * `omitidos`: jamás se le presta otro secreto.
 */
export function resolverDestinosShop(tenantId: string, fila: FilaShop, env: EnvShop): ResolucionDestinos {
  const destinos: DestinoShopEtiquetado[] = []
  const omitidos: string[] = []

  const principal = resolverDestinoShop(tenantId, fila, env)
  if (principal && principal.urlInterna && principal.secret) {
    destinos.push({ ...principal, etiqueta: ETIQUETA_PRINCIPAL })
  } else if (tieneUrlPropia(fila)) {
    omitidos.push(ETIQUETA_PRINCIPAL)
  }

  const hayExtras = Array.isArray(fila.shopDestinosExtra) && fila.shopDestinosExtra.length > 0
  if (!tieneUrlPropia(fila)) {
    if (hayExtras) console.warn(`[shop-destino] el tenant ${tenantId} tiene destinos extra pero no URL de Shop propia: se ignoran`)
    return { destinos, omitidos }
  }

  const { validos, descartados } = parsearDestinosExtra(fila.shopDestinosExtra, [fila.shopUrl, fila.shopInternalUrl])
  omitidos.push(...descartados)
  for (const extra of validos) {
    const nombre = nombreSecretoExtra(tenantId, extra.etiqueta)
    const secret = limpio(env[nombre])
    if (!secret) {
      console.warn(`[shop-destino] el destino extra "${extra.etiqueta}" de ${tenantId} no tiene ${nombre}: no se avisa a ese Shop`)
      omitidos.push(extra.etiqueta)
      continue
    }
    destinos.push({ etiqueta: extra.etiqueta, urlInterna: extra.urlInterna, urlPublica: extra.url, secret })
  }
  return { destinos, omitidos }
}

type TenantShopUrls = { id: string; shopUrl?: string; shopInternalUrl?: string; shopDestinosExtra?: unknown }

/** Extras válidos del tenant; solo rigen si el principal tiene URL propia (igual que el ping). */
function extrasPublicos(tenant: TenantShopUrls): DestinoExtra[] {
  const fila = { shopUrl: tenant.shopUrl ?? "", shopInternalUrl: tenant.shopInternalUrl ?? "" }
  if (!tieneUrlPropia(fila)) return []
  return parsearDestinosExtra(tenant.shopDestinosExtra, [fila.shopUrl, fila.shopInternalUrl]).validos
}

/** URLs públicas del Shop del tenant: la principal primero, después los extras válidos. */
export function urlsPublicasShop(tenant: TenantShopUrls, env: EnvShop = process.env): string[] {
  const principal = urlPublicaShopDeTenant(tenant, env)
  const urls = principal ? [principal] : []
  for (const e of extrasPublicos(tenant)) urls.push(e.url)
  return urls
}

/**
 * URL pública del Shop donde se hizo un pedido. Si `sitioOrigen` coincide con el principal o con
 * un extra, devuelve la URL CONFIGURADA (nunca el texto guardado); NULL, desconocido o inválido
 * → el principal.
 */
export function urlPublicaShopParaPedido(
  tenant: TenantShopUrls,
  sitioOrigen: string | null | undefined,
  env: EnvShop = process.env,
): string | null {
  const principal = urlPublicaShopDeTenant(tenant, env)
  const origen = origenSeguro(sitioOrigen)
  if (!origen) return principal
  const extra = extrasPublicos(tenant).find((e) => e.url === origen)
  return extra ? extra.url : principal
}
