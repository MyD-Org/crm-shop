import { sql } from "drizzle-orm"
import { getDb } from "@/db"

// Demanda del "Avisarme cuando ingrese" del Shop (`shop.avisos_reingreso`), para el admin.
//
// Reglas de este archivo:
//  - `tenantId` es SIEMPRE el primer argumento y se filtra en avisos, catálogo y overlay.
//  - SQL crudo parametrizado. Sólo lectura: el Shop escribe los avisos y el cron los marca.
//  - Pendiente = avisado_at IS NULL AND unsubscribed_at IS NULL.
//  - El WhatsApp sólo sale si hay consentimiento de contacto; el email siempre (es el canal del aviso).
//  - `alegra_id` puede ser un id de variante o `<slug>:<id>` (cuenta de otra sucursal): si el espejo
//    no lo encuentra se devuelve el id crudo como nombre.

export const AVISOS_DEFAULT_LIMIT = 50
export const AVISOS_MAX_LIMIT = 50
/** Personas listadas por producto. */
export const AVISOS_MAX_INTERESADOS = 200

export const FILTROS_AVISOS = ["todos", "quieren_encargar"] as const
export type FiltroAvisos = (typeof FILTROS_AVISOS)[number]

export interface ListarDemandaFiltro {
  filtro?: FiltroAvisos
  start?: number
  /** Default AVISOS_DEFAULT_LIMIT, máximo AVISOS_MAX_LIMIT. */
  limit?: number
}

export interface DemandaProductoDto {
  alegraId: string
  /** Nombre del espejo/overlay, o el id crudo si no se encuentra. */
  nombre: string
  marca: string | null
  interesados: number
  unidades: number
  quierenEncargar: number
  primerPedido: string
  ultimoPedido: string
}

export interface InteresadoDto {
  id: string
  email: string
  whatsapp: string | null
  cantidad: number
  quiereEncargar: boolean
  creadoEn: string
}

interface FilaDemanda {
  alegra_id: string
  nombre: string | null
  marca: string | null
  interesados: number | string
  unidades: number | string
  encargar: number | string
  primero: Date | string
  ultimo: Date | string
}

interface FilaInteresado {
  id: string
  email: string
  whatsapp: string | null
  cantidad: number | string
  quiere_encargar: boolean
  created_at: Date | string
}

const iso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString()
const n = (v: string | number | null | undefined): number => {
  const x = Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}

export async function listarDemandaReingreso(
  tenantId: string,
  f: ListarDemandaFiltro = {},
): Promise<{ items: DemandaProductoDto[]; total: number }> {
  const start = Math.max(0, Math.trunc(f.start ?? 0) || 0)
  const limit = Math.min(
    AVISOS_MAX_LIMIT,
    Math.max(1, Math.trunc(f.limit ?? AVISOS_DEFAULT_LIMIT) || AVISOS_DEFAULT_LIMIT),
  )
  const soloEncargar = f.filtro === "quieren_encargar"

  const base = sql`
    WITH agrupado AS (
      SELECT a.alegra_id,
             count(*)::int AS interesados,
             coalesce(sum(a.cantidad), 0)::int AS unidades,
             count(*) FILTER (WHERE a.quiere_encargar)::int AS encargar,
             min(a.created_at) AS primero,
             max(a.created_at) AS ultimo
      FROM shop.avisos_reingreso a
      WHERE a.tenant_id = ${tenantId}
        AND a.avisado_at IS NULL
        AND a.unsubscribed_at IS NULL
      GROUP BY a.alegra_id
      ${soloEncargar ? sql`HAVING count(*) FILTER (WHERE a.quiere_encargar) > 0` : sql``}
    )`

  const [filas, conteo] = await Promise.all([
    getDb().execute(sql`
      ${base}
      SELECT g.alegra_id, coalesce(ov.nombre, cp.name) AS nombre, cp.brand AS marca,
             g.interesados, g.unidades, g.encargar, g.primero, g.ultimo
      FROM agrupado g
      LEFT JOIN public.catalog_products cp
        ON cp.tenant_id = ${tenantId} AND cp.alegra_id = g.alegra_id
      LEFT JOIN public.catalog_overlay ov
        ON ov.tenant_id = ${tenantId} AND ov.alegra_id = g.alegra_id
      ORDER BY g.interesados DESC, g.ultimo DESC, g.alegra_id
      LIMIT ${limit} OFFSET ${start}
    `),
    getDb().execute(sql`${base} SELECT count(*)::int AS total FROM agrupado`),
  ])

  return {
    items: (filas as unknown as FilaDemanda[]).map((r) => ({
      alegraId: r.alegra_id,
      nombre: r.nombre ?? r.alegra_id,
      marca: r.marca,
      interesados: n(r.interesados),
      unidades: n(r.unidades),
      quierenEncargar: n(r.encargar),
      primerPedido: iso(r.primero),
      ultimoPedido: iso(r.ultimo),
    })),
    total: n((conteo as unknown as { total: number }[])[0]?.total),
  }
}

export async function listarInteresadosDe(tenantId: string, alegraId: string): Promise<InteresadoDto[]> {
  const filas = await getDb().execute(sql`
    SELECT a.id::text AS id, a.email,
           CASE WHEN a.consentimiento_contacto THEN a.whatsapp ELSE NULL END AS whatsapp,
           a.cantidad, a.quiere_encargar, a.created_at
    FROM shop.avisos_reingreso a
    WHERE a.tenant_id = ${tenantId}
      AND a.alegra_id = ${alegraId}
      AND a.avisado_at IS NULL
      AND a.unsubscribed_at IS NULL
    ORDER BY a.created_at DESC, a.id
    LIMIT ${AVISOS_MAX_INTERESADOS}
  `)
  return (filas as unknown as FilaInteresado[]).map((r) => ({
    id: r.id,
    email: r.email,
    whatsapp: r.whatsapp,
    cantidad: n(r.cantidad),
    quiereEncargar: r.quiere_encargar,
    creadoEn: iso(r.created_at),
  }))
}
