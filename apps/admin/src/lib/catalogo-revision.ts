import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { alegraCuentas, catalogSyncLog } from "@/db/schema"
import type { ResumenSync } from "./alegra-sync-cuenta"

// Datos de la solapa "Revisión" del catálogo (change `sucursales-igz-mdp`, rebanada D):
//  - "Códigos a revisar": SOLO errores de carga de la última sync de cada cuenta secundaria
//    (código duplicado o faltante). Esos ítems no entran al catálogo ni al stock.
//  - "Productos solo en <cuenta>": informativo. Son productos legítimos que existen únicamente en
//    esa cuenta; se editan desde Productos como cualquier otro.
// Todo filtra por tenant; nada de credenciales.

export const TOPE_SOLO_EN_CUENTA = 200

export interface ProductoSoloEnCuenta {
  alegraId: string
  code: string | null
  nombre: string
  stock: string | null
  /** Se ofrece hoy (activa y no dada de baja en su cuenta). */
  activo: boolean
  /** La principal lo tiene inactivo y esta cuenta lo "adoptó" (se muestra mientras haya stock). */
  adoptado: boolean
  visible: boolean
}

export interface RevisionCuenta {
  slug: string
  nombre: string
  /** Nombre de la sucursal que usa la cuenta (la primera por orden). */
  sucursal: string | null
  activa: boolean
  /** Última corrida con resumen (ok o parcial), no la última a secas. */
  ultimaSync: { estado: string; finalizadaEn: string | null; motivo: string | null } | null
  resumen: ResumenSync | null
  soloEnCuenta: { total: number; items: ProductoSoloEnCuenta[] }
}

interface FilaSolo {
  alegra_id: string
  code: string | null
  nombre: string
  stock: string | null
  status: string
  alegra_status: string | null
  visible: boolean | null
  adoptado: boolean
}

export async function revisionDeCatalogo(tenantId: string): Promise<RevisionCuenta[]> {
  const db = getDb()
  const cuentas = await db
    .select()
    .from(alegraCuentas)
    .where(and(eq(alegraCuentas.tenantId, tenantId), eq(alegraCuentas.principal, false)))
    .orderBy(asc(alegraCuentas.slug))

  const out: RevisionCuenta[] = []
  for (const c of cuentas) {
    const [log] = await db
      .select({
        status: catalogSyncLog.status,
        finishedAt: catalogSyncLog.finishedAt,
        error: catalogSyncLog.error,
        resumen: catalogSyncLog.resumen,
      })
      .from(catalogSyncLog)
      .where(and(eq(catalogSyncLog.tenantId, tenantId), eq(catalogSyncLog.cuentaId, c.id), isNotNull(catalogSyncLog.resumen)))
      .orderBy(desc(catalogSyncLog.startedAt))
      .limit(1)

    const [suc] = (await db.execute(sql`
      SELECT nombre FROM sucursales WHERE tenant_id = ${tenantId} AND cuenta_alegra_id = ${c.id}::uuid ORDER BY orden, slug LIMIT 1
    `)) as unknown as { nombre: string }[]

    const filas = (await db.execute(sql`
      SELECT p.alegra_id, p.code, coalesce(nullif(btrim(o.nombre), ''), p.name) AS nombre, p.stock, p.status, p.alegra_status,
             o.visible,
             EXISTS (
               SELECT 1 FROM catalog_products pr
               WHERE pr.tenant_id = p.tenant_id
                 AND pr.cuenta_id IS NULL
                 AND (pr.status = 'inactive' OR pr.alegra_status = 'inactive')
                 AND btrim(coalesce(p.code, '')) <> ''
                 AND lower(unaccent(btrim(pr.code))) = lower(unaccent(btrim(p.code)))
             ) AS adoptado
      FROM catalog_products p
      LEFT JOIN catalog_overlay o ON o.tenant_id = p.tenant_id AND o.alegra_id = p.alegra_id
      WHERE p.tenant_id = ${tenantId} AND p.cuenta_id = ${c.id}::uuid AND p.reemplazado_por_alegra_id IS NULL
      ORDER BY 3 ASC, p.alegra_id ASC
      LIMIT ${TOPE_SOLO_EN_CUENTA}
    `)) as unknown as FilaSolo[]
    const [conteo] = (await db.execute(sql`
      SELECT count(*)::int AS n FROM catalog_products
      WHERE tenant_id = ${tenantId} AND cuenta_id = ${c.id}::uuid AND reemplazado_por_alegra_id IS NULL
    `)) as unknown as { n: number }[]

    out.push({
      slug: c.slug,
      nombre: c.nombre,
      sucursal: suc?.nombre ?? null,
      activa: c.activa,
      ultimaSync: log ? { estado: log.status, finalizadaEn: log.finishedAt ? log.finishedAt.toISOString() : null, motivo: log.error } : null,
      resumen: (log?.resumen as ResumenSync | undefined) ?? null,
      soloEnCuenta: {
        total: Number(conteo?.n ?? 0),
        items: filas.map((f) => ({
          alegraId: f.alegra_id,
          code: f.code,
          nombre: f.nombre,
          stock: f.stock,
          activo: f.status === "active" && f.alegra_status !== "inactive",
          adoptado: f.adoptado,
          visible: f.visible ?? false,
        })),
      },
    })
  }
  return out
}
