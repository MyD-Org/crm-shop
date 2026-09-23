import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { TenantConfig } from "./tenants"
import {
  ALEGRA_PAGE_SIZE,
  AlegraHttpError,
  AlegraRateLimitError,
  mapRawContactRow,
  paginaDeContactos,
} from "./alegra"
import {
  abrirCorrida,
  avanzarPasada,
  cerrarCorrida,
  contarVistosDesde,
  marcarNoVistos,
  pasadaEnCurso,
  registrarSalteo,
  upsertContactos,
  type PasadaEnCurso,
} from "./alegra-contacts-repo"

// Sync del padrón de contactos de Alegra al espejo (tabla alegra_contacts), por tenant y POR
// TRAMOS. La dispara /api/cron/alegra-contactos-sync desde GitHub Actions, una vez por minuto
// mientras quede padrón por leer.
//
// Por qué por tramos: `/contacts` admite ~5 requests por minuto por cuenta (probado contra
// Alegra el 2026-09-23) y el login del portal y el bot comparten ese cupo. Central LED tiene
// ~6000 contactos (~200 páginas): no hay forma de leerlo entero en una invocación sin
// dejarlos sin cupo. Cada invocación lee a lo sumo PAGINAS_POR_TRAMO páginas, las guarda en
// el momento y deja el cursor en la bitácora; la siguiente sigue desde ahí.
//
// Una PASADA = de start=0 hasta la página corta o vacía. Vive en una fila de
// alegra_contacts_sync_log con status 'running' (ver alegra-contacts-repo.ts: la fila es el
// cursor). Bajas soft SOLO al cerrar la pasada entera y si vio al menos el 80 % de los
// contactos: una paginación truncada no puede dar de baja medio padrón.

/** Páginas de 30 por invocación. 3/min deja ~2/min de /contacts al login y al bot. */
export const PAGINAS_POR_TRAMO = 3

/**
 * Una pasada sin avanzar hace más de esto se da por abandonada y se empieza otra desde cero.
 * Más de 24 h a propósito: si la corrida de una noche no llega a terminar (tope del workflow),
 * la de la noche siguiente la RETOMA; si se reiniciara, un padrón más grande que el tope
 * nunca terminaría una pasada.
 */
export const PASADA_VENCE_MS = 30 * 60 * 60 * 1000

/** Fracción mínima del padrón que la pasada tiene que ver para marcar bajas. */
export const UMBRAL_CORRIDA_COMPLETA = 0.8

export interface ContactsSyncResult {
  ok: boolean
  skipped?: boolean
  /**
   * No hace falta volver a llamar por este tenant: la pasada cerró (bien o mal), o no hay nada
   * que hacer. `false` = quedan páginas; llamar de nuevo en ~1 minuto.
   */
  done: boolean
  /** Contactos leídos en ESTE tramo. */
  contactsSynced: number
  /** Contactos leídos en toda la pasada hasta ahora (= el cursor). */
  totalPasada: number
  markedInactive: number
  /** Requests de ESTE tramo (reintentos incluidos). */
  requests: number
  /** El tramo cortó antes de sus páginas, sin error: la pasada sigue en la próxima. */
  cortado?: "alegra_429" | "sin_tiempo"
  /** Motivo técnico corto (sin datos de contactos). */
  error?: string
}

/**
 * Motivo para la bitácora y la respuesta: se arma SOLO con tipo y status del error, nunca
 * con su mensaje (el de Alegra trae el body de la respuesta, que puede tener datos).
 */
function motivoDeError(err: unknown): string {
  if (err instanceof AlegraRateLimitError) return "alegra_429"
  if (err instanceof AlegraHttpError) return `alegra_http_${err.status}`
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return `db_${code}`
  return "error_interno"
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Corre UN tramo de la sync de contactos de un tenant. Nunca tira: todo termina en la
 * bitácora y en el resultado. Si otra invocación del mismo tenant está en medio de un tramo,
 * se saltea (`skipped`, `done: false`: la próxima vuelve a intentar).
 */
export async function syncContacts(
  config: TenantConfig,
  trigger: "cron" | "manual",
  opts: { deadline?: number; intervaloMs?: number } = {},
): Promise<ContactsSyncResult> {
  const vacio = { contactsSynced: 0, totalPasada: 0, markedInactive: 0, requests: 0 }

  if (!config.alegraMock && !config.alegraToken) {
    await registrarSalteo(config.id, trigger, "sin_credenciales")
    return { ok: true, skipped: true, done: true, ...vacio, error: "sin_credenciales" }
  }

  // Candado por tenant mientras dura el TRAMO (unos segundos: 3 páginas de ~3 s). Evita que
  // dos invocaciones lean el mismo cursor o abran dos pasadas. Es de TRANSACCIÓN (no de
  // sesión) a propósito: con un pooler, un pg_advisory_lock de sesión se puede tomar en una
  // conexión y liberar en otra. La transacción solo sostiene el candado; el trabajo va por el
  // pool. Con la sync de un tirón esto dejaba una transacción ociosa 2–3 min; por tramos es
  // corta y el candado sigue siendo lo más simple que no necesita migración.
  const clave = `alegra_contacts:${config.id}`
  let resultado: ContactsSyncResult | null = null
  try {
    await getDb().transaction(async (tx) => {
      const r = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${clave})) AS tomado`)
      if (!r[0]?.tomado) return
      resultado = await tramo(config, trigger, opts)
    })
  } catch (err) {
    // Solo llega acá si falla la transacción del candado (el tramo no tira).
    console.error(`alegra-contacts-sync: ${config.id}: ${motivoDeError(err)}`)
    return { ok: false, done: true, ...vacio, error: motivoDeError(err) }
  }
  if (resultado) return resultado

  await registrarSalteo(config.id, trigger, "corrida_en_curso")
  return { ok: true, skipped: true, done: false, ...vacio, error: "corrida_en_curso" }
}

/** La pasada en curso, o una nueva si no hay (o si la que había quedó abandonada). */
async function pasadaParaSeguir(config: TenantConfig, trigger: "cron" | "manual"): Promise<PasadaEnCurso> {
  const abierta = await pasadaEnCurso(config.id)
  if (abierta && Date.now() - abierta.ultimoAvance.getTime() <= PASADA_VENCE_MS) return abierta
  if (abierta) {
    // Sin bajas: lo que alcanzó a leer ya quedó upserteado y eso es todo.
    await cerrarCorrida(abierta.id, {
      status: "error",
      contactsSynced: abierta.cursor,
      markedInactive: 0,
      requests: abierta.requests,
      error: "pasada_abandonada",
    })
  }
  const startedAt = new Date()
  const id = await abrirCorrida(config.id, trigger, startedAt)
  return { id, startedAt, cursor: 0, requests: 0, ultimoAvance: startedAt }
}

async function tramo(
  config: TenantConfig,
  trigger: "cron" | "manual",
  opts: { deadline?: number; intervaloMs?: number },
): Promise<ContactsSyncResult> {
  const intervaloMs = opts.intervaloMs ?? 700
  let pasada: PasadaEnCurso | null = null
  let cursor = 0
  let requests = 0
  let leidos = 0
  const acumuladas = () => (pasada?.requests ?? 0) + requests
  const parcial = (cortado?: ContactsSyncResult["cortado"]): ContactsSyncResult => ({
    ok: true,
    done: false,
    contactsSynced: leidos,
    totalPasada: cursor,
    markedInactive: 0,
    requests,
    ...(cortado ? { cortado } : {}),
  })

  try {
    pasada = await pasadaParaSeguir(config, trigger)
    cursor = pasada.cursor

    for (let i = 0; i < PAGINAS_POR_TRAMO; i++) {
      if (opts.deadline != null && Date.now() > opts.deadline) return parcial("sin_tiempo")
      const inicio = Date.now()

      let page: Record<string, unknown>[]
      try {
        page = await paginaDeContactos(config, cursor, {
          onRequest: () => {
            requests++
          },
        })
      } catch (err) {
        // Cupo de /contacts agotado (lo usan también el portal y el bot): no es una falla de
        // la pasada. Se anota lo gastado y sigue en la próxima invocación, sin reintentar acá.
        if (!(err instanceof AlegraRateLimitError)) throw err
        await avanzarPasada(pasada.id, { cursor, requests: acumuladas() })
        return parcial("alegra_429")
      }

      // Se guarda EN EL MOMENTO: si la invocación muere después, lo leído no se pierde.
      if (page.length > 0) await upsertContactos(config.id, page.map(mapRawContactRow), "sync")
      cursor += page.length
      leidos += page.length
      await avanzarPasada(pasada.id, { cursor, requests: acumuladas() })

      if (page.length < ALEGRA_PAGE_SIZE) return await cerrarPasada(config, pasada, cursor, leidos, requests, acumuladas())

      const espera = intervaloMs - (Date.now() - inicio)
      if (espera > 0 && i < PAGINAS_POR_TRAMO - 1) await sleep(espera)
    }
    return parcial()
  } catch (err) {
    const error = motivoDeError(err)
    console.error(`alegra-contacts-sync: ${config.id}: ${error}`)
    // La pasada se cierra en error, sin bajas: la próxima arranca otra desde cero.
    if (pasada) {
      try {
        await cerrarCorrida(pasada.id, { status: "error", contactsSynced: cursor, markedInactive: 0, requests: acumuladas(), error })
      } catch {
        // La bitácora no puede tapar el resultado.
      }
    }
    return { ok: false, done: true, contactsSynced: leidos, totalPasada: cursor, markedInactive: 0, requests, error }
  }
}

/** Última página leída: guarda del 80 %, bajas soft y cierre de la bitácora. */
async function cerrarPasada(
  config: TenantConfig,
  pasada: PasadaEnCurso,
  cursor: number,
  leidos: number,
  requests: number,
  requestsPasada: number,
): Promise<ContactsSyncResult> {
  // "Vistos" = filas escritas desde que arrancó la pasada; "no vistos" = activas que se darían
  // de baja. Si las bajas pasaran del 20 % del padrón, la pasada vio de menos: sospechosa.
  const { vistos, activosNoVistos } = await contarVistosDesde(config.id, pasada.startedAt)
  const base = { contactsSynced: leidos, totalPasada: cursor, requests }
  if (activosNoVistos > 0 && vistos < UMBRAL_CORRIDA_COMPLETA * (vistos + activosNoVistos)) {
    const error = "corrida_sospechosa"
    await cerrarCorrida(pasada.id, { status: "error", contactsSynced: cursor, markedInactive: 0, requests: requestsPasada, error })
    return { ok: false, done: true, ...base, markedInactive: 0, error }
  }

  const markedInactive = await marcarNoVistos(config.id, pasada.startedAt)
  await cerrarCorrida(pasada.id, { status: "ok", contactsSynced: cursor, markedInactive, requests: requestsPasada })
  return { ok: true, done: true, ...base, markedInactive }
}
