import { and, asc, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas } from "@/db/schema"
import { CUENTA_ALEGRA_PRINCIPAL } from "./alegra-contacts-repo"
import { configParaCuenta, type CuentaCredenciales, type Entorno } from "./sucursales-cuenta"
import type { TenantConfig } from "./tenants"

// Qué cuentas de Alegra sincroniza el cron de contactos para un tenant (change
// `espejo-contactos-por-cuenta`, rebanada A): la PRINCIPAL y cada cuenta secundaria ACTIVA. Una
// secundaria sin credenciales no corta al resto: queda como objetivo con `motivoSalteo` y el cron
// registra el salteo en su bitácora.

export interface ObjetivoSync {
  tenant: string
  /** Slug de la cuenta ('principal' o el de la sucursal). */
  cuenta: string
  /** Config con las credenciales de ESA cuenta; `null` si no se pudo armar (ver `motivoSalteo`). */
  config: TenantConfig | null
  motivoSalteo?: "sin_credenciales"
}

/** Cuentas secundarias activas del tenant, ordenadas por slug. */
export async function leerCuentasSecundariasActivas(tenantId: string): Promise<CuentaCredenciales[]> {
  const rows = await getDb()
    .select()
    .from(alegraCuentas)
    .where(and(eq(alegraCuentas.tenantId, tenantId), eq(alegraCuentas.principal, false), eq(alegraCuentas.activa, true)))
    .orderBy(asc(alegraCuentas.slug))
  return rows.map((r) => ({
    slug: r.slug,
    principal: false,
    alegraEmail: r.alegraEmail,
    alegraToken: r.alegraToken,
    alegraMock: r.alegraMock,
  }))
}

/**
 * Objetivos de la sync de un tenant (que ya tiene Alegra en la principal). `soloCuenta` = slug:
 * devuelve solo esa cuenta (o nada si no existe / no está activa).
 */
export async function objetivosDeTenant(
  base: TenantConfig,
  soloCuenta: string | null,
  deps: { leerCuentas?: (tenantId: string) => Promise<CuentaCredenciales[]>; env?: Entorno } = {},
): Promise<ObjetivoSync[]> {
  const leerCuentas = deps.leerCuentas ?? leerCuentasSecundariasActivas
  const objetivos: ObjetivoSync[] = []

  if (!soloCuenta || soloCuenta === CUENTA_ALEGRA_PRINCIPAL) {
    objetivos.push({ tenant: base.id, cuenta: CUENTA_ALEGRA_PRINCIPAL, config: base })
  }
  if (soloCuenta === CUENTA_ALEGRA_PRINCIPAL) return objetivos

  let secundarias: CuentaCredenciales[] = []
  try {
    secundarias = await leerCuentas(base.id)
  } catch (err) {
    // Sin poder leer las cuentas queda la sync de la principal, como antes de este cambio.
    console.warn(`[alegra-contactos-objetivos] tenant=${base.id} no se pudieron leer las cuentas: ${err instanceof Error ? err.name : "error"}`)
  }
  for (const cuenta of secundarias) {
    if (soloCuenta && cuenta.slug !== soloCuenta) continue
    try {
      objetivos.push({ tenant: base.id, cuenta: cuenta.slug, config: configParaCuenta(base, cuenta, deps.env) })
    } catch {
      // configParaCuenta lanza (con un mensaje en usted) si la cuenta no tiene credenciales.
      objetivos.push({ tenant: base.id, cuenta: cuenta.slug, config: null, motivoSalteo: "sin_credenciales" })
    }
  }
  return objetivos
}
