// Marca de los mails de un pedido según el sitio donde se compró (change `marca-por-dominio`).
// PURO: recibe el tenant ya cargado.
//
// - Sitio extra CON marca propia: su nombre, su remitente (si lo tiene) y su logo de mail. Si no
//   tiene logo de mail, va sin logo: NUNCA el de Central ni el del tenant.
// - Alias del principal, principal, sitio desconocido o null: lo de siempre.

import { safeLogoUrl } from "@/lib/email-layout"
import { logoMailDeTenant } from "@/lib/email-logo"
import { extrasPublicos, origenSeguro, type TenantShopUrls } from "@/lib/shop-destino"

export interface MarcaMail {
  name: string
  resendFrom: string
  logoUrl: string | null
}

type TenantMarca = TenantShopUrls & { name: string; resendFrom: string; logoPath?: string | null }

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

export function marcaParaSitio(tenant: TenantMarca, sitioOrigen: string | null | undefined): MarcaMail {
  const origen = origenSeguro(sitioOrigen)
  const extra = origen ? extrasPublicos(tenant).find((e) => e.url === origen) : undefined
  const marca = extra?.marca
  if (extra && marca && Object.keys(marca).length > 0) {
    return {
      name: texto(marca.nombre) || tenant.name,
      resendFrom: extra.remitente ?? tenant.resendFrom,
      logoUrl: safeLogoUrl(texto(marca.logoMailUrl)),
    }
  }
  return { name: tenant.name, resendFrom: tenant.resendFrom, logoUrl: logoMailDeTenant(tenant) }
}
