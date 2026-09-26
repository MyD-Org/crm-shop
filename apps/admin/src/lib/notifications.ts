import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { notificationLog, notificationRules, tenants as tenantsTable } from "@/db/schema"
import { getClientes, getFacturas } from "@/lib/erp"
import { sendEmail } from "@/lib/email"
import { safeLogoUrl } from "@/lib/email-layout"
import { buildCobranzaEmail } from "@/lib/cobranza-email"
import { tenantConfigFromRow, type TenantConfig } from "@/lib/tenants"
import type { Cliente, Factura } from "@/types"

// ── Gestor de Cobranza ──────────────────────────────────────────────────────
// Recorre las facturas impagas de cada cliente, cruza con las reglas del
// tenant (días antes/después del vencimiento) y envía recordatorios por email.
// La deduplicación la garantiza el unique index nl_dedup de notification_log.

export interface NotificationResult {
  sent: number
  skipped: number
  failed: number
  details: string[]
}

interface PendingNotification {
  cliente: Cliente
  factura: Factura
  type: string // 'before_due_3' | 'after_due_7' ...
  diasDiff: number // negativo = faltan días, positivo = días de mora
}

function parseFecha(d: string): Date {
  const [dd, mm, yyyy] = d.split("/").map(Number)
  return new Date(yyyy, mm - 1, dd)
}

function diasDesdeVencimiento(factura: Factura, hoy: Date): number {
  const venc = parseFecha(factura.vencimiento)
  return Math.round((hoy.getTime() - venc.getTime()) / 86_400_000)
}

function saldoDe(f: Factura): number {
  return f.importe - (f.pagado ?? 0)
}

function buildEmail(tenant: TenantConfig, cliente: Cliente, items: PendingNotification[]) {
  return buildCobranzaEmail({
    tenantName: tenant.name,
    logoUrl: safeLogoUrl(tenant.logoPath),
    clienteNombre: cliente.razonsocial,
    items: items.map((i) => ({
      facturaId: i.factura.id,
      vencimiento: i.factura.vencimiento,
      saldo: saldoDe(i.factura),
      diasDiff: i.diasDiff,
    })),
  })
}

export async function runNotifications(filter?: {
  tenantId?: string
  codigocliente?: string
}): Promise<NotificationResult> {
  const db = getDb()
  const result: NotificationResult = { sent: 0, skipped: 0, failed: 0, details: [] }
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)

  const rules = await db
    .select()
    .from(notificationRules)
    .innerJoin(tenantsTable, eq(notificationRules.tenantId, tenantsTable.id))
    .where(
      filter?.tenantId
        ? and(eq(notificationRules.enabled, true), eq(notificationRules.tenantId, filter.tenantId))
        : eq(notificationRules.enabled, true),
    )

  for (const { notification_rules: rule, tenants: tenantRow } of rules) {
    const tenant = tenantConfigFromRow(tenantRow)
    const daysBefore = rule.daysBefore as number[]
    const daysAfter = rule.daysAfter as number[]
    const channels = rule.channels as string[]

    if (!channels.includes("email")) continue

    let clientes = await getClientes(tenant)
    if (filter?.codigocliente) clientes = clientes.filter((c) => c.codigocliente === filter.codigocliente)

    for (const cliente of clientes) {
      if (!cliente.email) {
        result.skipped++
        result.details.push(`${cliente.codigocliente}: sin email, omitido`)
        continue
      }

      const facturas = await getFacturas(tenant, cliente.codigocliente)
      const pendientes: PendingNotification[] = []

      for (const factura of facturas) {
        // Una anulada no se reclama: mandarle un recordatorio de pago al cliente por una
        // factura que la empresa dio de baja es peor que no mandar nada.
        if (factura.estado === "pagada" || factura.estado === "anulada") continue
        const diff = diasDesdeVencimiento(factura, hoy)

        let type: string | null = null
        if (diff < 0 && daysBefore.includes(-diff)) type = `before_due_${-diff}`
        else if (diff >= 0 && daysAfter.includes(diff)) type = `after_due_${diff}`
        if (!type) continue

        // Deduplicación: si ya se ENVIÓ (status sent) para (tenant, cliente,
        // factura, type, canal), saltear. Los failed se reintentan.
        const [existing] = await db
          .select({ id: notificationLog.id })
          .from(notificationLog)
          .where(
            and(
              eq(notificationLog.tenantId, tenant.id),
              eq(notificationLog.codigocliente, cliente.codigocliente),
              eq(notificationLog.facturaId, factura.id),
              eq(notificationLog.type, type),
              eq(notificationLog.channel, "email"),
              eq(notificationLog.status, "sent"),
            ),
          )
        if (existing) {
          result.skipped++
          continue
        }

        pendientes.push({ cliente, factura, type, diasDiff: diff })
      }

      if (!pendientes.length) continue

      // Un solo email por cliente agrupando todas sus facturas
      const { subject, html, text } = buildEmail(tenant, cliente, pendientes)
      let status = "sent"
      let errorMsg: string | null = null
      try {
        await sendEmail(tenant, cliente.email, subject, html, text)
        result.sent += pendientes.length
        result.details.push(`${cliente.codigocliente}: email con ${pendientes.length} factura(s)`)
      } catch (err) {
        status = "failed"
        errorMsg = err instanceof Error ? err.message : String(err)
        result.failed += pendientes.length
        result.details.push(`${cliente.codigocliente}: ERROR ${errorMsg}`)
      }

      for (const p of pendientes) {
        await db
          .insert(notificationLog)
          .values({
            tenantId: tenant.id,
            codigocliente: cliente.codigocliente,
            facturaId: p.factura.id,
            // Para que "Ver factura" en la campanita abra el PDF sin tener que encontrar la
            // factura por número, que Alegra no permite.
            facturaAlegraId: p.factura.alegraId ?? null,
            type: p.type,
            channel: "email",
            status,
            error: errorMsg,
          })
          .onConflictDoUpdate({
            target: [
              notificationLog.tenantId,
              notificationLog.codigocliente,
              notificationLog.facturaId,
              notificationLog.type,
              notificationLog.channel,
            ],
            set: { status, error: errorMsg, sentAt: new Date(), facturaAlegraId: p.factura.alegraId ?? null },
          })
      }
    }
  }

  return result
}
