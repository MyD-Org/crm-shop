// Logo de la cabecera de los mails del CRM: el mismo PNG que usan los mails del Shop, para que
// todos los mails de una tienda luzcan iguales.
//
// 1. Si el tenant configuró un logo propio apto para mail (`safeLogoUrl`: absoluto, PNG/JPG), ése.
// 2. Central: el logo de mail que publica su tienda (apps/clientes/public/images/central-led/
//    logo-mail.png, el logo del header sobre una placa blanca que se lee en modo oscuro).
// 3. Si no, null: la cabecera va con el nombre en texto (nunca el logo de otra marca).

import { safeLogoUrl } from "@/lib/email-layout"
import { urlPublicaShopDeTenant } from "@/lib/shop-destino"

/** Tenant con logo de mail publicado en su tienda, y su ruta ahí. */
const LOGO_MAIL_EN_SHOP: Readonly<Record<string, string>> = {
  "central-led": "/images/central-led/logo-mail.png",
}

export function logoMailDeTenant(
  tenant: { id: string; logoPath?: string | null; shopUrl?: string; shopInternalUrl?: string },
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const propio = safeLogoUrl(tenant.logoPath)
  if (propio) return propio
  const ruta = Object.hasOwn(LOGO_MAIL_EN_SHOP, tenant.id) ? LOGO_MAIL_EN_SHOP[tenant.id] : null
  if (!ruta) return null
  const shop = urlPublicaShopDeTenant(tenant, env)
  return shop ? `${shop}${ruta}` : null
}
