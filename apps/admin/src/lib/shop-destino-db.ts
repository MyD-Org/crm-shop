// Lectura de las dos columnas del Shop de un tenant (`tenants.shop_url`, `shop_internal_url`).
// Va aparte de shop-destino.ts para que ese módulo siga siendo puro. Nunca tira: si la base no
// responde (o la columna aún no existe) devuelve la fila vacía y rige el par histórico de envs,
// que es lo que pasaba antes de 0084.

import type { FilaShop } from "@/lib/shop-destino"

const FILA_VACIA: FilaShop = { shopUrl: "", shopInternalUrl: "" }

export async function leerFilaShop(tenantId: string): Promise<FilaShop> {
  try {
    const { getDb } = await import("@/db")
    const { tenants } = await import("@/db/schema")
    const { eq } = await import("drizzle-orm")
    const [row] = await getDb()
      .select({ shopUrl: tenants.shopUrl, shopInternalUrl: tenants.shopInternalUrl })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
    return row ?? FILA_VACIA
  } catch (err) {
    console.warn(`[shop-destino] no se pudo leer la URL del Shop de ${tenantId}: ${err instanceof Error ? err.name : "error"}`)
    return FILA_VACIA
  }
}
