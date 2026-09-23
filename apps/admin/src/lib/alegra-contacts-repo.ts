import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm"
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
 * Baja soft: las filas activas que la pasada no vio (synced_at anterior a su inicio) pasan a
 * 'inactive'. Solo al cerrar una pasada completa. Devuelve cuántas marcó.
 */
export async function marcarNoVistos(
  tenantId: string,
  inicioPasada: Date,
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
        lt(alegraContacts.syncedAt, inicioPasada),
      ),
    )
    .returning({ id: alegraContacts.id })
  return rows.length
}

/**
 * Para la guarda de bajas al cerrar una pasada: cuántas filas se escribieron desde que
 * arrancó (`vistos`, cualquier origen: un fallback en vivo también prueba que el contacto
 * existe) y cuántas activas quedaron sin tocar (`activosNoVistos`, las que se darían de baja).
 */
export async function contarVistosDesde(
  tenantId: string,
  inicioPasada: Date,
  cuenta = CUENTA_ALEGRA_PRINCIPAL,
): Promise<{ vistos: number; activosNoVistos: number }> {
  const del = and(eq(alegraContacts.tenantId, tenantId), eq(alegraContacts.alegraAccount, cuenta))
  const [v] = await getDb()
    .select({ n: count() })
    .from(alegraContacts)
    .where(and(del, gte(alegraContacts.syncedAt, inicioPasada)))
  const [nv] = await getDb()
    .select({ n: count() })
    .from(alegraContacts)
    .where(and(del, eq(alegraContacts.status, "active"), lt(alegraContacts.syncedAt, inicioPasada)))
  return { vistos: v?.n ?? 0, activosNoVistos: nv?.n ?? 0 }
}

// ── Bitácora (alegra_contacts_sync_log) ──
//
// Una fila por PASADA (de start=0 hasta la última página), no por invocación. Mientras la
// pasada está en curso (`status='running'`) la fila hace de cursor, sin columnas nuevas:
// - `contacts_synced` = filas leídas de Alegra en la pasada = el próximo `start`. Toda página
//   que no es la última trae exactamente 30, así que la suma de lo leído ES el cursor.
// - `requests` = requests acumuladas de la pasada (reintentos incluidos).
// - `finished_at` = fin del último tramo. En una pasada cerrada, fin de la pasada.

export type EstadoCorrida = "running" | "ok" | "error" | "skipped"

export interface PasadaEnCurso {
  id: string
  startedAt: Date
  /** Próximo `start` a pedir. */
  cursor: number
  requests: number
  /** Último avance: fin del último tramo, o el inicio si todavía no hubo ninguno. */
  ultimoAvance: Date
}

/** La pasada abierta más reciente del tenant, si hay. */
export async function pasadaEnCurso(tenantId: string, cuenta = CUENTA_ALEGRA_PRINCIPAL): Promise<PasadaEnCurso | null> {
  const [row] = await getDb()
    .select()
    .from(alegraContactsSyncLog)
    .where(
      and(
        eq(alegraContactsSyncLog.tenantId, tenantId),
        eq(alegraContactsSyncLog.alegraAccount, cuenta),
        eq(alegraContactsSyncLog.status, "running"),
      ),
    )
    .orderBy(desc(alegraContactsSyncLog.startedAt))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    startedAt: row.startedAt,
    cursor: row.contactsSynced,
    requests: row.requests,
    ultimoAvance: row.finishedAt ?? row.startedAt,
  }
}

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

/**
 * Deja constancia de una invocación que no hizo nada (sin credenciales, u otra invocación del
 * mismo tenant con el candado). Entra directo como 'skipped': si pasara por 'running', otra
 * invocación podría tomarla por la pasada en curso en ese instante.
 */
export async function registrarSalteo(
  tenantId: string,
  trigger: "cron" | "manual",
  error: string,
  cuenta = CUENTA_ALEGRA_PRINCIPAL,
): Promise<void> {
  const ahora = new Date()
  await getDb()
    .insert(alegraContactsSyncLog)
    .values({ tenantId, alegraAccount: cuenta, trigger, status: "skipped", error, startedAt: ahora, finishedAt: ahora })
}

/** Guarda el cursor de una pasada en curso. Se llama después de upsertear cada página. */
export async function avanzarPasada(id: string, r: { cursor: number; requests: number }): Promise<void> {
  await getDb()
    .update(alegraContactsSyncLog)
    .set({ contactsSynced: r.cursor, requests: r.requests, finishedAt: new Date() })
    .where(eq(alegraContactsSyncLog.id, id))
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
