import { and, asc, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas, catalogSyncCursor } from "@/db/schema"
import type { TenantConfig } from "./tenants"
import { syncCatalogTramo, type CursorPrincipal, type SyncResult } from "./alegra-sync"
import { syncCuentaSecundaria, type SyncCuentaResult } from "./alegra-sync-cuenta"
import { MSG_SYNC_EN_CURSO, VENTANA_CORRIDA_EN_CURSO_MIN } from "./alegra-sync-guarda"

// Orquesta la sync de TODAS las cuentas de un tenant (change `sucursales-igz-mdp`, rebanada D,
// design D3): primero la PRINCIPAL y después cada cuenta secundaria ACTIVA. El orden importa: la
// absorción de la principal va antes del alta de solo-secundaria. Una falla de una cuenta no frena
// a la otra. Sin cuentas secundarias activas es exactamente la sync de siempre.
//
// REANUDABLE POR TRAMOS: la principal de un tenant grande (~18 000 ítems) tarda ~5 min (Alegra:
// 30 ítems por página, 150 req/min) y no entra en una invocación de 300 s. Con `presupuestoMs`,
// `syncTenant` procesa hasta agotarlo y, si no terminó, guarda un cursor (`catalog_sync_cursor`:
// cuenta actual, offset de lectura, resultados ya cerrados) y devuelve `continuar: true`; la
// siguiente invocación retoma desde ahí. Las bajas, la absorción y el resumen de una cuenta corren
// SÓLO cuando su pasada completa terminó. Cada cuenta es al menos un tramo propio: no se empieza
// la siguiente en el mismo tramo si queda menos de la mitad del presupuesto. La principal se
// reanuda a mitad de la lectura; una secundaria es un solo tramo (necesita todos sus ítems para
// el pareo). Sin `presupuestoMs` corre todo de una vez (tests, herramientas).

export interface Progreso {
  /** "principal" o el slug de la cuenta secundaria en curso. */
  cuenta: string
  /** Ítems ya leídos de esa cuenta (solo la principal informa avance dentro de la cuenta). */
  leidos: number
  /** Ítems de la última corrida OK, para mostrar "N de ~M"; null si no hay. */
  estimado: number | null
  /** Cuentas secundarias que faltan (sin contar la actual). */
  restantes: number
}

/**
 * Avance de la corrida para quien quiera mostrarlo (el runner de GitHub Actions lo imprime).
 * Solo lleva conteos y el slug de la cuenta: nada sensible. Es opcional y no cambia el
 * comportamiento de las rutas, que no lo pasan.
 */
export type EventoProgreso =
  | { tipo: "cuenta-inicio"; cuenta: string }
  | { tipo: "lectura"; cuenta: string; leidos: number }
  | { tipo: "cuenta-fin"; cuenta: string; ok: boolean; itemsSynced: number }

export interface SyncTenantResult extends SyncResult {
  /** Resumen por cuenta secundaria; ausente si el tenant no tiene ninguna activa. */
  cuentas?: SyncCuentaResult[]
  /** La corrida sigue: volver a llamar para el próximo tramo. */
  continuar?: boolean
  progreso?: Progreso
}

/** Estado de la corrida a medias de un tenant (se guarda en `catalog_sync_cursor.cursor`). */
export interface CursorSync {
  v: 1
  fase: "principal" | "secundarias"
  principal: CursorPrincipal | null
  principalResult: SyncResult | null
  /** Slugs de las secundarias que faltan, en orden. */
  pendientes: string[]
  cuentas: SyncCuentaResult[]
}

/** Un tramo en ejecución retiene el cursor este tiempo (> maxDuration de las rutas). */
export const LOCK_TRAMO_MS = 330_000
/** Presupuesto por defecto de un tramo (deja margen sobre maxDuration = 300 s). */
export const PRESUPUESTO_TRAMO_MS = 220_000

const cursorNuevo = (): CursorSync => ({
  v: 1,
  fase: "principal",
  principal: null,
  principalResult: null,
  pendientes: [],
  cuentas: [],
})

type Toma = { enCurso: true } | { enCurso: false; cursor: CursorSync }

/**
 * Toma el cursor del tenant (o lo crea) y lo bloquea para este tramo. Un cursor sin actividad
 * hace más de VENTANA_CORRIDA_EN_CURSO_MIN es una corrida abandonada: se descarta y se empieza
 * de cero (las filas del log 'running' las marca 'error' la guarda de concurrencia).
 */
async function tomarCursor(tenantId: string): Promise<Toma> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`alegra-sync-cursor:${tenantId}`}))`)
    const [row] = await tx.select().from(catalogSyncCursor).where(eq(catalogSyncCursor.tenantId, tenantId))
    const lockHasta = new Date(Date.now() + LOCK_TRAMO_MS)
    if (row) {
      const abandonado = Date.now() - row.actividadAt.getTime() > VENTANA_CORRIDA_EN_CURSO_MIN * 60_000
      if (!abandonado) {
        if (row.lockHasta && row.lockHasta.getTime() > Date.now()) return { enCurso: true }
        await tx.update(catalogSyncCursor).set({ lockHasta, actividadAt: new Date() }).where(eq(catalogSyncCursor.tenantId, tenantId))
        return { enCurso: false, cursor: row.cursor as CursorSync }
      }
    }
    const cursor = cursorNuevo()
    await tx
      .insert(catalogSyncCursor)
      .values({ tenantId, cursor, lockHasta, actividadAt: new Date() })
      .onConflictDoUpdate({ target: catalogSyncCursor.tenantId, set: { cursor, lockHasta, actividadAt: new Date() } })
    return { enCurso: false, cursor }
  })
}

async function guardarCursor(tenantId: string, cursor: CursorSync, liberar: boolean): Promise<void> {
  await getDb()
    .update(catalogSyncCursor)
    .set({ cursor, actividadAt: new Date(), ...(liberar ? { lockHasta: null } : {}) })
    .where(eq(catalogSyncCursor.tenantId, tenantId))
}

async function borrarCursor(tenantId: string): Promise<void> {
  await getDb().delete(catalogSyncCursor).where(eq(catalogSyncCursor.tenantId, tenantId))
}

async function secundariasActivas(tenantId: string): Promise<(typeof alegraCuentas.$inferSelect)[]> {
  try {
    return await getDb()
      .select()
      .from(alegraCuentas)
      .where(and(eq(alegraCuentas.tenantId, tenantId), eq(alegraCuentas.principal, false), eq(alegraCuentas.activa, true)))
      .orderBy(asc(alegraCuentas.slug))
  } catch (err) {
    console.warn(`[alegra-sync-tenant] tenant=${tenantId} no se pudieron leer las cuentas: ${err instanceof Error ? err.name : "error"}`)
    return []
  }
}

function resultadoFinal(cur: CursorSync): SyncTenantResult {
  const principal = cur.principalResult ?? { ok: false, itemsSynced: 0, categoriesSynced: 0, error: "sync_failed" }
  if (cur.cuentas.length === 0) return principal
  const fallidas = cur.cuentas.filter((c) => !c.ok)
  if (fallidas.length === 0) return { ...principal, cuentas: cur.cuentas }
  return {
    ...principal,
    ok: false,
    error: principal.ok ? `No se pudo sincronizar la cuenta ${fallidas.map((c) => c.cuenta).join(", ")}.` : principal.error,
    cuentas: cur.cuentas,
  }
}

function resultadoParcial(cur: CursorSync): SyncTenantResult {
  const p = cur.principal
  const progreso: Progreso =
    cur.fase === "principal"
      ? { cuenta: "principal", leidos: p?.items ?? 0, estimado: p?.base?.items ?? null, restantes: cur.pendientes.length }
      : { cuenta: cur.pendientes[0] ?? "", leidos: 0, estimado: null, restantes: Math.max(0, cur.pendientes.length - 1) }
  return {
    ok: true,
    continuar: true,
    itemsSynced: cur.fase === "principal" ? (p?.items ?? 0) : (cur.principalResult?.itemsSynced ?? 0),
    categoriesSynced: cur.fase === "principal" ? (p?.categorias ?? 0) : (cur.principalResult?.categoriesSynced ?? 0),
    progreso,
    ...(cur.cuentas.length ? { cuentas: cur.cuentas } : {}),
  }
}

export async function syncTenant(
  config: TenantConfig,
  trigger: "cron" | "manual",
  opts: { aceptarBaja?: boolean; presupuestoMs?: number; onProgreso?: (e: EventoProgreso) => void } = {},
): Promise<SyncTenantResult> {
  const presupuesto = opts.presupuestoMs ?? Number.POSITIVE_INFINITY
  const deadline = Date.now() + presupuesto
  // Cada cuenta tiene su tramo: si queda menos de la mitad del presupuesto, la próxima va aparte.
  const hayMargen = () => deadline - Date.now() >= presupuesto / 2
  const syncOpts = { aceptarBaja: opts.aceptarBaja }
  // Un observador que falla nunca puede tirar la sync.
  const avisar = (e: EventoProgreso) => {
    try {
      opts.onProgreso?.(e)
    } catch {
      /* solo informativo */
    }
  }

  const toma = await tomarCursor(config.id)
  if (toma.enCurso) return { ok: false, itemsSynced: 0, categoriesSynced: 0, error: MSG_SYNC_EN_CURSO }
  const cur = toma.cursor

  try {
    if (cur.fase === "principal") {
      avisar({ tipo: "cuenta-inicio", cuenta: "principal" })
      const t = await syncCatalogTramo(config, trigger, syncOpts, cur.principal, {
        deadline,
        onProgreso: async (p) => {
          cur.principal = p
          avisar({ tipo: "lectura", cuenta: "principal", leidos: p.items })
          await guardarCursor(config.id, cur, false)
        },
      })
      if (!t.fin) {
        cur.principal = t.cursor
        await guardarCursor(config.id, cur, true)
        return resultadoParcial(cur)
      }
      cur.principalResult = t.result
      avisar({ tipo: "cuenta-fin", cuenta: "principal", ok: t.result.ok, itemsSynced: t.result.itemsSynced })
      cur.principal = null
      cur.pendientes = (await secundariasActivas(config.id)).map((c) => c.slug)
      cur.fase = "secundarias"
      if (cur.pendientes.length > 0 && !hayMargen()) {
        await guardarCursor(config.id, cur, true)
        return resultadoParcial(cur)
      }
      await guardarCursor(config.id, cur, false)
    }

    while (cur.pendientes.length > 0) {
      const slug = cur.pendientes[0]
      const cuentas = await secundariasActivas(config.id)
      const c = cuentas.find((x) => x.slug === slug)
      if (!c) {
        // La cuenta se desactivó o borró entre tramos: no hay nada que sincronizar.
        cur.pendientes.shift()
        continue
      }
      avisar({ tipo: "cuenta-inicio", cuenta: slug })
      try {
        cur.cuentas.push(await syncCuentaSecundaria(config, c, trigger, syncOpts))
      } catch (err) {
        // syncCuentaSecundaria no debería lanzar (devuelve ok:false); por si falla la base.
        console.error(`[alegra-sync-tenant] tenant=${config.id} cuenta=${slug} error: ${err instanceof Error ? err.name : "error"}`)
        cur.cuentas.push({ ok: false, cuenta: slug, itemsSynced: 0, categoriesSynced: 0, error: "sync_failed" })
      }
      const ultima = cur.cuentas[cur.cuentas.length - 1]
      avisar({ tipo: "cuenta-fin", cuenta: slug, ok: ultima.ok, itemsSynced: ultima.itemsSynced })
      cur.pendientes.shift()
      if (cur.pendientes.length > 0 && !hayMargen()) {
        await guardarCursor(config.id, cur, true)
        return resultadoParcial(cur)
      }
      await guardarCursor(config.id, cur, false)
    }

    await borrarCursor(config.id)
    return resultadoFinal(cur)
  } catch (err) {
    // Falla inesperada (base caída): se libera el cursor para que el próximo intento lo retome.
    await guardarCursor(config.id, cur, true).catch(() => {})
    throw err
  }
}
