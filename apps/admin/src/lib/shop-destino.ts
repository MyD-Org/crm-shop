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

export interface FilaShop {
  shopUrl: string
  shopInternalUrl: string
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
