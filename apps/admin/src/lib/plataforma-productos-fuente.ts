import { and, asc, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProducts } from "@/db/schema"
import type { CursorProductos } from "@/lib/plataforma-proyeccion-repo"

export type FilaProducto = Pick<typeof catalogProducts.$inferSelect, "alegraId" | "name" | "code" | "description" | "brand" | "categoryAlegraId" | "status" | "alegraStatus" | "stock" | "images" | "syncedAt">

const syncedAtMs = sql`date_trunc('milliseconds', ${catalogProducts.syncedAt})`

/**
 * Productos del tenant tocados por la sync después del cursor, en orden (synced_at, alegra_id).
 * La sync escribe UN synced_at por lote, así que muchas filas empatan: el cursor es compuesto y
 * se compara por fila. El cursor viaja por un Date de JS (milisegundos): si una fila vieja tuviera
 * microsegundos, `synced_at > cursor` la volvería a devolver siempre (bucle). Por eso filtro y orden
 * usan `date_trunc('milliseconds', synced_at)`, que es lo mismo que ve el Date al leer la fila.
 */
export async function leerProductosDesde(tenantId: string, cursor: CursorProductos, lote: number): Promise<FilaProducto[]> {
  return getDb().select({
    alegraId: catalogProducts.alegraId, name: catalogProducts.name, code: catalogProducts.code, description: catalogProducts.description,
    brand: catalogProducts.brand, categoryAlegraId: catalogProducts.categoryAlegraId, status: catalogProducts.status, alegraStatus: catalogProducts.alegraStatus,
    stock: catalogProducts.stock, images: catalogProducts.images, syncedAt: catalogProducts.syncedAt,
  }).from(catalogProducts)
    .where(and(
      eq(catalogProducts.tenantId, tenantId),
      sql`(${syncedAtMs}, ${catalogProducts.alegraId}) > (${cursor.at.toISOString()}::timestamptz, ${cursor.clave})`,
    ))
    .orderBy(asc(syncedAtMs), asc(catalogProducts.alegraId)).limit(lote)
}

/** Un producto del tenant (mismas columnas que `leerProductosDesde`), o null si no existe. */
export async function leerProducto(tenantId: string, alegraId: string): Promise<FilaProducto | null> {
  const [fila] = await getDb().select({
    alegraId: catalogProducts.alegraId, name: catalogProducts.name, code: catalogProducts.code, description: catalogProducts.description,
    brand: catalogProducts.brand, categoryAlegraId: catalogProducts.categoryAlegraId, status: catalogProducts.status, alegraStatus: catalogProducts.alegraStatus,
    stock: catalogProducts.stock, images: catalogProducts.images, syncedAt: catalogProducts.syncedAt,
  }).from(catalogProducts)
    .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.alegraId, alegraId)))
    .limit(1)
  return fila ?? null
}
