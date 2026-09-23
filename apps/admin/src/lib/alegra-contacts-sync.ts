import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { TenantConfig } from "./tenants"
import {
  AlegraHttpError,
  AlegraRateLimitError,
  SinTiempoError,
  listAllContactsPausado,
  mapRawContactRow,
} from "./alegra"
import {
  CUENTA_ALEGRA_PRINCIPAL,
  abrirCorrida,
  cerrarCorrida,
  contarActivos,
  marcarNoVistos,
  upsertContactos,
} from "./alegra-contacts-repo"

// Sync del padrón de contactos de Alegra al espejo (tabla alegra_contacts), por tenant.
// Completa, secuencial y pausada (ver listAllContactsPausado). Deja bitácora en
// alegra_contacts_sync_log. La dispara /api/cron/alegra-contactos-sync desde GitHub Actions.
//
// Bajas soft: SOLO si la corrida terminó bien y vio al menos el 80 % de los contactos que
// estaban activos. Una paginación truncada (Alegra corta en la primera página corta) no puede
// dar de baja medio padrón.

/** Fracción mínima de activos previos que la corrida tiene que ver para marcar bajas. */
export const UMBRAL_CORRIDA_COMPLETA = 0.8

export interface ContactsSyncResult {
  ok: boolean
  skipped?: boolean
  contactsSynced: number
  markedInactive: number
  requests: number
  /** Motivo técnico corto (sin datos de contactos). */
  error?: string
}

/**
 * Motivo para la bitácora y la respuesta: se arma SOLO con tipo y status del error, nunca
 * con su mensaje (el de Alegra trae el body de la respuesta, que puede tener datos).
 */
function motivoDeError(err: unknown): string {
  if (err instanceof SinTiempoError) return "sin_tiempo"
  if (err instanceof AlegraRateLimitError) return "alegra_429"
  if (err instanceof AlegraHttpError) return `alegra_http_${err.status}`
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return `db_${code}`
  return "error_interno"
}

/**
 * Corre la sync de contactos de un tenant. Nunca tira: todo termina en la bitácora y en el
 * resultado. Si otra corrida del mismo tenant está viva, se saltea (`skipped`).
 */
export async function syncContacts(
  config: TenantConfig,
  trigger: "cron" | "manual",
  opts: { deadline?: number; intervaloMs?: number } = {},
): Promise<ContactsSyncResult> {
  const vacio = { contactsSynced: 0, markedInactive: 0, requests: 0 }

  if (!config.alegraMock && !config.alegraToken) {
    const id = await abrirCorrida(config.id, trigger, new Date())
    await cerrarCorrida(id, { status: "skipped", ...vacio, error: "sin_credenciales" })
    return { ok: true, skipped: true, ...vacio, error: "sin_credenciales" }
  }

  // Candado por tenant mientras dura la corrida. Es de TRANSACCIÓN (no de sesión) a
  // propósito: con un pooler, un pg_advisory_lock de sesión se puede tomar en una conexión
  // y liberar en otra. La transacción solo sostiene el candado; el trabajo va por el pool.
  const clave = `alegra_contacts:${config.id}`
  let resultado: ContactsSyncResult | null = null
  try {
    await getDb().transaction(async (tx) => {
      const r = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${clave})) AS tomado`)
      if (!r[0]?.tomado) return
      resultado = await correr(config, trigger, opts)
    })
  } catch (err) {
    // Solo llega acá si falla la transacción del candado (la corrida no tira).
    console.error(`alegra-contacts-sync: ${config.id}: ${motivoDeError(err)}`)
    return { ok: false, ...vacio, error: motivoDeError(err) }
  }
  if (resultado) return resultado

  const id = await abrirCorrida(config.id, trigger, new Date())
  await cerrarCorrida(id, { status: "skipped", ...vacio, error: "corrida_en_curso" })
  return { ok: true, skipped: true, ...vacio, error: "corrida_en_curso" }
}

async function correr(
  config: TenantConfig,
  trigger: "cron" | "manual",
  opts: { deadline?: number; intervaloMs?: number },
): Promise<ContactsSyncResult> {
  const runStart = new Date()
  const logId = await abrirCorrida(config.id, trigger, runStart)
  let requests = 0
  let contactsSynced = 0
  let markedInactive = 0

  try {
    const activosPrevios = await contarActivos(config.id, CUENTA_ALEGRA_PRINCIPAL)
    const raws = await listAllContactsPausado(config, {
      intervaloMs: opts.intervaloMs,
      deadline: opts.deadline,
      onRequest: () => {
        requests++
      },
    })
    const filas = await upsertContactos(config.id, raws.map(mapRawContactRow), "sync", { ahora: runStart })
    contactsSynced = filas.length

    if (activosPrevios > 0 && contactsSynced < UMBRAL_CORRIDA_COMPLETA * activosPrevios) {
      const error = "corrida_sospechosa"
      await cerrarCorrida(logId, { status: "error", contactsSynced, markedInactive, requests, error })
      return { ok: false, contactsSynced, markedInactive, requests, error }
    }

    markedInactive = await marcarNoVistos(config.id, runStart, CUENTA_ALEGRA_PRINCIPAL)
    await cerrarCorrida(logId, { status: "ok", contactsSynced, markedInactive, requests })
    return { ok: true, contactsSynced, markedInactive, requests }
  } catch (err) {
    const error = motivoDeError(err)
    console.error(`alegra-contacts-sync: ${config.id}: ${error}`)
    try {
      await cerrarCorrida(logId, { status: "error", contactsSynced, markedInactive, requests, error })
    } catch {
      // La bitácora no puede tapar el resultado.
    }
    return { ok: false, contactsSynced, markedInactive, requests, error }
  }
}
