import { after } from "next/server"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { getDb } from "@/db"
import { adminUsers, tenants } from "@/db/schema"
import {
  buildCuentaBancariaAvisoEmail,
  type TipoCambioCuenta,
} from "@/lib/cuentas-bancarias-shop-aviso-email"
import type { CuentaBancariaDto } from "@/lib/cuentas-bancarias-shop-repo"
import { sendEmail } from "@/lib/email"
import { logoMailDeTenant } from "@/lib/email-logo"
import { EMPTY_TENANT, tenantConfigFromRow } from "@/lib/tenants"

// Aviso por mail a los admin/superadmin del tenant cuando cambian las cuentas bancarias de la
// tienda. Nunca rompe ni demora el guardado: se agenda con `after()` y todo error se loguea sin
// datos sensibles (sólo el mensaje del proveedor, nunca CBU ni direcciones).

export interface AvisoCuentaParams {
  tenantId: string
  tipo: TipoCambioCuenta
  actor: { name: string; email: string }
  antes?: CuentaBancariaDto | null
  despues?: CuentaBancariaDto | null
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Arma y manda el aviso. No lanza nunca. */
export async function avisarCambioCuentaBancaria(p: AvisoCuentaParams, fecha: Date = new Date()): Promise<void> {
  try {
    const db = getDb()
    const [destinatarios, [tenantRow]] = await Promise.all([
      db
        .select({ name: adminUsers.name, email: adminUsers.email })
        .from(adminUsers)
        .where(
          and(
            eq(adminUsers.tenantId, p.tenantId),
            inArray(adminUsers.role, ["admin", "superadmin"]),
            isNotNull(adminUsers.passwordHash),
          ),
        ),
      db.select().from(tenants).where(eq(tenants.id, p.tenantId)),
    ])
    const tenant = tenantRow ? tenantConfigFromRow(tenantRow) : EMPTY_TENANT
    const logoUrl = logoMailDeTenant(tenant)

    const resultados = await Promise.allSettled(
      destinatarios.map(async (d) => {
        const mail = buildCuentaBancariaAvisoEmail({
          tenantName: tenant.name,
          logoUrl,
          nombreDestinatario: d.name,
          tipo: p.tipo,
          actor: p.actor,
          fecha,
          antes: p.antes,
          despues: p.despues,
        })
        if (!mail) return // sin cambios reales: nada que avisar
        await sendEmail(tenant, d.email, mail.subject, mail.html, mail.text)
      }),
    )
    for (const r of resultados) {
      if (r.status === "rejected") console.error("[cuentas-bancarias-aviso] no se pudo enviar un mail:", msg(r.reason))
    }
  } catch (err) {
    console.error("[cuentas-bancarias-aviso] fallo el aviso:", msg(err))
  }
}

/**
 * Agenda el aviso para después de responder (`after`). Fuera de un request (tests) `after`
 * lanza: se cae a un envío no bloqueante con catch. Nunca lanza.
 */
export function programarAvisoCuentaBancaria(p: AvisoCuentaParams): void {
  const tarea = () => avisarCambioCuentaBancaria(p)
  try {
    after(tarea)
  } catch {
    void tarea().catch(() => {})
  }
}
