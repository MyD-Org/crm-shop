import { and, eq, inArray, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { preciosOnlineCambios, preciosOnlineRetenciones } from "@/db/schema"
import { avisarShop } from "./aviso-shop"
import { PreciosOnlineError, idsSql, idsUuidSql, lockTenant, type Tx, type UsuarioActor } from "./precios-online-repo"

// Costos que llegan desde Alegra (change `listas-precio-online`, rebanada B): recálculo de los
// precios online tras la sync / el webhook, retención por variación de costo y su bandeja de
// aprobación, y los contadores de alertas.

export interface ResultadoRecalculo {
  actualizados: number
  retenidos: number
}

/**
 * Recalcula los precios online de `ids` (modo 'costo': aplica el costo nuevo o lo RETIENE si la
 * variación supera el umbral). `ids = null` = todo el tenant. La función SQL toma el mismo
 * advisory lock que la vista previa y el aplicar: la sync y un cambio masivo se serializan.
 */
export async function recalcularPreciosItems(tenantId: string, ids: string[] | null): Promise<ResultadoRecalculo> {
  if (ids !== null && ids.length === 0) return { actualizados: 0, retenidos: 0 }
  const rows = (await getDb().execute(
    sql`SELECT * FROM aplicar_precios_online(${tenantId}, ${idsSql(ids)}, 'costo')`,
  )) as unknown as ResultadoRecalculo[]
  return rows[0]
}

/** Barrido completo del tenant (idempotente): cierra la sync diaria y el script manual. */
export const recalcularTodos = (tenantId: string) => recalcularPreciosItems(tenantId, null)

/**
 * Recálculo "best effort" que usan la sync y el webhook: un error se registra y NO tumba la
 * sincronización (el barrido diario lo recupera). Un fallo típico: la migración 0064 sin aplicar.
 */
export async function recalcularTrasSync(tenantId: string, ids: string[] | null, origen: string): Promise<void> {
  try {
    const r = await recalcularPreciosItems(tenantId, ids)
    if (r.retenidos > 0) {
      console.info(`[precios-online] tenant=${tenantId} origen=${origen} retenidos=${r.retenidos}`)
    }
  } catch (err) {
    console.warn(`[precios-online] tenant=${tenantId} origen=${origen} el recálculo falló: ${err instanceof Error ? err.message : "error"}`)
  }
}

// ── Retenciones ─────────────────────────────────────────────────────────────────────────────

export interface RetenidoDto {
  id: string
  alegraId: string
  code: string | null
  nombre: string
  costoVigente: string | null
  costoPropuesto: string | null
  variacionPct: string | null
  creadoAt: string
  /** true si el costo propuesto es nulo: aprobarlo dejaría el producto sin precio. */
  sinCosto: boolean
}

export async function listarRetenidos(
  tenantId: string,
  opts: { start: number; limit: number },
): Promise<{ items: RetenidoDto[]; total: number }> {
  const db = getDb()
  const [{ total }] = (await db.execute(sql`
    SELECT count(*)::int AS total FROM precios_online_retenciones WHERE tenant_id = ${tenantId} AND estado = 'pendiente'
  `)) as unknown as { total: number }[]
  const rows = (await db.execute(sql`
    SELECT r.id, r.alegra_id AS "alegraId", p.code, coalesce(o.nombre, p.name, r.alegra_id) AS nombre,
           r.costo_vigente::text AS "costoVigente", r.costo_propuesto::text AS "costoPropuesto",
           r.variacion_pct::text AS "variacionPct", r.creado_at AS "creadoAt"
    FROM precios_online_retenciones r
    LEFT JOIN catalog_products p ON p.tenant_id = r.tenant_id AND p.alegra_id = r.alegra_id
    LEFT JOIN catalog_overlay o ON o.tenant_id = r.tenant_id AND o.alegra_id = r.alegra_id
    WHERE r.tenant_id = ${tenantId} AND r.estado = 'pendiente'
    ORDER BY r.creado_at DESC, r.id
    LIMIT ${opts.limit} OFFSET ${opts.start}
  `)) as unknown as (Omit<RetenidoDto, "sinCosto" | "creadoAt"> & { creadoAt: Date | string })[]
  return {
    total,
    items: rows.map((r) => ({
      ...r,
      creadoAt: new Date(r.creadoAt).toISOString(),
      sinCosto: r.costoPropuesto === null,
    })),
  }
}

export interface ResultadoResolucion {
  resueltos: number
  /** Retenidos que no se pudieron aprobar (costo propuesto vacío) o que ya no estaban pendientes. */
  omitidos: string[]
}

type Pendiente = typeof preciosOnlineRetenciones.$inferSelect

async function pendientesDe(tx: Tx, tenantId: string, ids: string[]): Promise<Pendiente[]> {
  if (ids.length === 0) return []
  return tx
    .select()
    .from(preciosOnlineRetenciones)
    .where(
      and(
        eq(preciosOnlineRetenciones.tenantId, tenantId),
        eq(preciosOnlineRetenciones.estado, "pendiente"),
        inArray(preciosOnlineRetenciones.id, ids),
      ),
    )
}

/**
 * Aprueba retenidos: el costo propuesto pasa a ser el vigente (costo_aplicado), se recalcula el
 * precio y queda en el historial (quién, antes, después). Un retenido sin costo propuesto NO se
 * aprueba (el producto quedaría sin precio): se omite y se informa.
 */
export async function aprobarRetenidos(
  tenantId: string,
  usuario: UsuarioActor,
  ids: string[],
): Promise<ResultadoResolucion> {
  const quien = usuario.email || usuario.id
  const r = await getDb().transaction(async (tx) => {
    await lockTenant(tx, tenantId)
    const pendientes = await pendientesDe(tx, tenantId, ids)
    const aprobables = pendientes.filter((p) => p.costoPropuesto !== null)
    const omitidos = ids.filter((id) => !aprobables.some((p) => p.id === id))
    const alegraIds = aprobables.map((p) => p.alegraId)
    // Precio vigente ANTES (para el historial).
    const antes = new Map<string, string | null>()
    if (alegraIds.length) {
      const filas = (await tx.execute(sql`
        SELECT alegra_id, precio_online_ref::text AS ref FROM catalog_products
        WHERE tenant_id = ${tenantId} AND alegra_id = ANY (${idsSql(alegraIds)})
      `)) as unknown as { alegra_id: string; ref: string | null }[]
      for (const f of filas) antes.set(f.alegra_id, f.ref)
      await tx.execute(sql`
        UPDATE catalog_products p SET costo_aplicado = r.costo_propuesto
        FROM precios_online_retenciones r
        WHERE r.id = ANY (${idsUuidSql(aprobables.map((a) => a.id))})
          AND p.tenant_id = r.tenant_id AND p.alegra_id = r.alegra_id
      `)
      await tx.execute(sql`SELECT * FROM aplicar_precios_online(${tenantId}, ${idsSql(alegraIds)}, 'config')`)
      await tx
        .update(preciosOnlineRetenciones)
        .set({ estado: "aprobada", resueltoAt: sql`now()`, resueltoPor: quien })
        .where(inArray(preciosOnlineRetenciones.id, aprobables.map((a) => a.id)))
      const despues = (await tx.execute(sql`
        SELECT alegra_id, precio_online_ref::text AS ref FROM catalog_products
        WHERE tenant_id = ${tenantId} AND alegra_id = ANY (${idsSql(alegraIds)})
      `)) as unknown as { alegra_id: string; ref: string | null }[]
      const dMap = new Map(despues.map((d) => [d.alegra_id, d.ref]))
      for (const p of aprobables) {
        await tx.insert(preciosOnlineCambios).values({
          tenantId,
          tipo: "costo_aprobado",
          objeto: `costo:${p.alegraId}`,
          antes: { costo: p.costoVigente, precio: antes.get(p.alegraId) ?? null },
          despues: { costo: p.costoPropuesto, precio: dMap.get(p.alegraId) ?? null },
          resumen: { variacionPct: p.variacionPct },
          usuario: quien,
          creadoAt: sql`clock_timestamp()`,
        })
      }
    }
    return { resueltos: aprobables.length, omitidos }
  })
  if (r.resueltos > 0) {
    try {
      await avisarShop(tenantId)
    } catch {
      /* el aviso es best-effort: el cambio ya está persistido */
    }
  }
  return r
}

/**
 * Rechaza retenidos: se mantiene el precio vigente y el costo propuesto se descarta. Un nuevo
 * cambio de costo (distinto) reabre la retención; el mismo costo no.
 */
export async function rechazarRetenidos(
  tenantId: string,
  usuario: UsuarioActor,
  ids: string[],
): Promise<ResultadoResolucion> {
  const quien = usuario.email || usuario.id
  return getDb().transaction(async (tx) => {
    await lockTenant(tx, tenantId)
    const pendientes = await pendientesDe(tx, tenantId, ids)
    const omitidos = ids.filter((id) => !pendientes.some((p) => p.id === id))
    if (pendientes.length) {
      await tx
        .update(preciosOnlineRetenciones)
        .set({ estado: "rechazada", resueltoAt: sql`now()`, resueltoPor: quien })
        .where(inArray(preciosOnlineRetenciones.id, pendientes.map((p) => p.id)))
      for (const p of pendientes) {
        await tx.insert(preciosOnlineCambios).values({
          tenantId,
          tipo: "costo_rechazado",
          objeto: `costo:${p.alegraId}`,
          antes: { costo: p.costoVigente },
          despues: { costo: p.costoVigente, descartado: p.costoPropuesto },
          resumen: { variacionPct: p.variacionPct },
          usuario: quien,
          creadoAt: sql`clock_timestamp()`,
        })
      }
    }
    return { resueltos: pendientes.length, omitidos }
  })
}

// ── Alertas ─────────────────────────────────────────────────────────────────────────────────

export interface AlertasPrecios {
  sinCosto: number
  sinPrecio: number
  nuevosSinRevisar: number
  retenidos: number
}

/**
 * Contadores de la alerta de pendientes. Se cuentan los productos que la tienda podría ofrecer
 * (activos, sin los absorbidos por su par de otra cuenta).
 *  - sinCosto: costo nulo (sin precio, aunque tengan un precio vigente retenido).
 *  - sinPrecio: con costo pero sin precio online (típicamente: todavía no hay listas).
 *  - nuevosSinRevisar: sin fila de overlay (nadie los revisó ni habilitó).
 *  - retenidos: cambios de costo pendientes de aprobación.
 */
export async function contarAlertas(tenantId: string): Promise<AlertasPrecios> {
  const [r] = (await getDb().execute(sql`
    SELECT
      (count(*) FILTER (WHERE p.costo IS NULL))::int AS "sinCosto",
      (count(*) FILTER (WHERE p.costo IS NOT NULL AND p.precios_online = '[]'::jsonb))::int AS "sinPrecio",
      (count(*) FILTER (WHERE o.id IS NULL))::int AS "nuevosSinRevisar",
      (SELECT count(*)::int FROM precios_online_retenciones r WHERE r.tenant_id = ${tenantId} AND r.estado = 'pendiente') AS retenidos
    FROM catalog_products p
    LEFT JOIN catalog_overlay o ON o.tenant_id = p.tenant_id AND o.alegra_id = p.alegra_id
    WHERE p.tenant_id = ${tenantId} AND p.status = 'active' AND p.reemplazado_por_alegra_id IS NULL
  `)) as unknown as AlertasPrecios[]
  return r
}

export { PreciosOnlineError }
