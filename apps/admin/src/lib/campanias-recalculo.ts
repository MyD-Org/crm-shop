import { sql } from "drizzle-orm"
import type { Db } from "@/db"
import type { Tx } from "./precios-online-repo"

// Recálculo de campañas cuando cambia algo que decide QUÉ regla alcanza a un producto (su categoría
// o su grupo de variantes), sin esperar al barrido de la sync (spec 2026-10-28-campanias-precios).
// Módulo aparte y sin dependencias de los repos del catálogo para no crear ciclos de import.

type Ejecutor = Db | Tx

/**
 * `aplicar_campanias_online` para los productos de los modelos tocados: el overlay se guarda por
 * `alegra_id`, pero la categoría que cuenta es la del ancla del modelo, así que se recalculan todos
 * los productos cuyo `coalesce(grupo_id, alegra_id)` es uno de esos ids. `null` = todo el tenant.
 */
export async function recalcularCampanias(ej: Ejecutor, tenantId: string, alegraIds: string[] | null): Promise<void> {
  if (alegraIds === null) {
    await ej.execute(sql`SELECT aplicar_campanias_online(${tenantId}, NULL::text[])`)
    return
  }
  if (alegraIds.length === 0) return
  const ids = sql`ARRAY[${sql.join(alegraIds.map((i) => sql`${i}`), sql`, `)}]::text[]`
  await ej.execute(sql`
    SELECT aplicar_campanias_online(${tenantId}, (
      SELECT coalesce(array_agg(p.alegra_id), ARRAY[]::text[])
      FROM catalog_products p
      WHERE p.tenant_id = ${tenantId}
        AND (p.alegra_id = ANY (${ids}) OR coalesce(p.grupo_id, p.alegra_id) = ANY (${ids}))
    ))
  `)
}
