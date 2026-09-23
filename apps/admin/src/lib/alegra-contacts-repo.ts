import { and, count, eq, lt, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraContacts, alegraContactsSyncLog } from "@/db/schema"
import type { FilaContactoAlegra } from "./alegra"

// SQL sobre el espejo de contactos de Alegra (tabla alegra_contacts) y su bitácora. Sin red:
// la API de Alegra vive en lib/alegra.ts y la sync en lib/alegra-contacts-sync.ts.

/** Hoy todo tenant tiene UNA cuenta de Alegra. Todo lector filtra por esta constante. */
export const CUENTA_ALEGRA_PRINCIPAL = "principal"

export type OrigenContacto = "sync" | "fallback" | "write_through"
export type ContactoEspejoRow = typeof alegraContacts.$inferSelect

const LOTE = 500

/**
 * Inserta o pisa filas del espejo por (tenant, cuenta, alegra_id). Pisa TODO menos el id:
 * la fila queda `status='active'`, con `synced_at` de ahora y el `origen` de quien escribió.
 * Si `filas` repite un alegra_id (Alegra corrió la paginación mientras se leía), queda la
 * última: Postgres no deja que un mismo INSERT … ON CONFLICT toque dos veces la misma fila.
 */
export async function upsertContactos(
  tenantId: string,
  filas: FilaContactoAlegra[],
  origen: OrigenContacto,
  opts: { cuenta?: string; ahora?: Date } = {},
): Promise<ContactoEspejoRow[]> {
  const cuenta = opts.cuenta ?? CUENTA_ALEGRA_PRINCIPAL
  const ahora = opts.ahora ?? new Date()
  const unicas = [...new Map(filas.map((f) => [f.alegraId, f])).values()]
  const db = getDb()
  const out: ContactoEspejoRow[] = []
  for (let i = 0; i < unicas.length; i += LOTE) {
    const lote = unicas.slice(i, i + LOTE)
    const rows = await db
      .insert(alegraContacts)
      .values(
        lote.map((f) => ({
          ...f,
          tenantId,
          alegraAccount: cuenta,
          status: "active",
          origen,
          syncedAt: ahora,
        })),
      )
      .onConflictDoUpdate({
        target: [alegraContacts.tenantId, alegraContacts.alegraAccount, alegraContacts.alegraId],
        set: {
          name: sql`excluded.name`,
          identification: sql`excluded.identification`,
          identificationNorm: sql`excluded.identification_norm`,
          email: sql`excluded.email`,
          emailsNorm: sql`excluded.emails_norm`,
          phonePrimary: sql`excluded.phone_primary`,
          phoneSecondary: sql`excluded.phone_secondary`,
          mobile: sql`excluded.mobile`,
          phonesNorm: sql`excluded.phones_norm`,
          types: sql`excluded.types`,
          priceListId: sql`excluded.price_list_id`,
          priceListName: sql`excluded.price_list_name`,
          priceListStatus: sql`excluded.price_list_status`,
          sellerId: sql`excluded.seller_id`,
          sellerName: sql`excluded.seller_name`,
          paymentTermId: sql`excluded.payment_term_id`,
          paymentTermName: sql`excluded.payment_term_name`,
          paymentTermDays: sql`excluded.payment_term_days`,
          creditLimit: sql`excluded.credit_limit`,
          alegraStatus: sql`excluded.alegra_status`,
          status: sql`excluded.status`,
          origen: sql`excluded.origen`,
          raw: sql`excluded.raw`,
          syncedAt: sql`excluded.synced_at`,
        },
      })
      .returning()
    out.push(...rows)
  }
  return out
}

/**
 * Baja soft: las filas activas que la corrida no vio (synced_at anterior al inicio) pasan a
 * 'inactive'. Solo después de una corrida OK. Devuelve cuántas marcó.
 */
export async function marcarNoVistos(
  tenantId: string,
  runStart: Date,
  cuenta = CUENTA_ALEGRA_PRINCIPAL,
): Promise<number> {
  const rows = await getDb()
    .update(alegraContacts)
    .set({ status: "inactive" })
    .where(
      and(
        eq(alegraContacts.tenantId, tenantId),
        eq(alegraContacts.alegraAccount, cuenta),
        eq(alegraContacts.status, "active"),
        lt(alegraContacts.syncedAt, runStart),
      ),
    )
    .returning({ id: alegraContacts.id })
  return rows.length
}

export async function contarActivos(tenantId: string, cuenta = CUENTA_ALEGRA_PRINCIPAL): Promise<number> {
  const [r] = await getDb()
    .select({ n: count() })
    .from(alegraContacts)
    .where(
      and(
        eq(alegraContacts.tenantId, tenantId),
        eq(alegraContacts.alegraAccount, cuenta),
        eq(alegraContacts.status, "active"),
      ),
    )
  return r?.n ?? 0
}

// ── Bitácora (alegra_contacts_sync_log) ──

export type EstadoCorrida = "running" | "ok" | "error" | "skipped"

export async function abrirCorrida(
  tenantId: string,
  trigger: "cron" | "manual",
  startedAt: Date,
  cuenta = CUENTA_ALEGRA_PRINCIPAL,
): Promise<string> {
  const [row] = await getDb()
    .insert(alegraContactsSyncLog)
    .values({ tenantId, alegraAccount: cuenta, trigger, status: "running", startedAt })
    .returning({ id: alegraContactsSyncLog.id })
  return row.id
}

/** `error` es un motivo técnico corto: NUNCA nombres, emails ni documentos. */
export async function cerrarCorrida(
  id: string,
  r: { status: Exclude<EstadoCorrida, "running">; contactsSynced: number; markedInactive: number; requests: number; error?: string },
): Promise<void> {
  await getDb()
    .update(alegraContactsSyncLog)
    .set({
      status: r.status,
      contactsSynced: r.contactsSynced,
      markedInactive: r.markedInactive,
      requests: r.requests,
      error: r.error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(alegraContactsSyncLog.id, id))
}

/** Inicio de la última corrida OK de cada tenant (para ordenar: la más vieja primero). */
export async function ultimaOkPorTenant(cuenta = CUENTA_ALEGRA_PRINCIPAL): Promise<Map<string, Date>> {
  const rows = await getDb()
    .select({ tenantId: alegraContactsSyncLog.tenantId, ultima: sql<Date>`max(${alegraContactsSyncLog.startedAt})`.mapWith((v) => new Date(v)) })
    .from(alegraContactsSyncLog)
    .where(and(eq(alegraContactsSyncLog.status, "ok"), eq(alegraContactsSyncLog.alegraAccount, cuenta)))
    .groupBy(alegraContactsSyncLog.tenantId)
  return new Map(rows.map((r) => [r.tenantId, r.ultima]))
}
