import { and, asc, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import type { CursorProductos } from "@/lib/plataforma-proyeccion-repo"

export type FilaProducto = Pick<typeof catalogProducts.$inferSelect, "alegraId" | "name" | "code" | "description" | "brand" | "categoryAlegraId" | "status" | "alegraStatus" | "stock" | "images" | "syncedAt">

/**
 * Productos del tenant tocados por la sync después del cursor, en orden (synced_at, alegra_id).
 * La sync escribe UN synced_at por lote, así que muchas filas empatan: el cursor es compuesto y
 * se compara por fila. Supone que synced_at se escribe desde Date de JS (ms): el viaje por Date
 * es exacto, no hay microsegundos que se pierdan al guardar el cursor.
 */
export async function leerProductosDesde(tenantId: string, cursor: CursorProductos, lote: number): Promise<FilaProducto[]> {
  return getDb().select({
    alegraId: catalogProducts.alegraId, name: catalogProducts.name, code: catalogProducts.code, description: catalogProducts.description,
    brand: catalogProducts.brand, categoryAlegraId: catalogProducts.categoryAlegraId, status: catalogProducts.status, alegraStatus: catalogProducts.alegraStatus,
    stock: catalogProducts.stock, images: catalogProducts.images, syncedAt: catalogProducts.syncedAt,
  }).from(catalogProducts)
    .where(and(
      eq(catalogProducts.tenantId, tenantId),
      sql`(${catalogProducts.syncedAt}, ${catalogProducts.alegraId}) > (${cursor.at.toISOString()}::timestamptz, ${cursor.clave})`,
    ))
    .orderBy(asc(catalogProducts.syncedAt), asc(catalogProducts.alegraId)).limit(lote)
}
