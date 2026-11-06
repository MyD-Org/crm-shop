// Lectura de las columnas del Shop de un tenant (`tenants.shop_url`, `shop_internal_url` y, desde
// 0099, `shop_destinos_extra`). Va aparte de shop-destino.ts para que ese módulo siga siendo puro.
// Nunca tira. Lee en tres niveles:
//   1. las tres columnas;
//   2. si falla (típico: la columna nueva aún no existe en esa base), las dos clásicas con
//      `shopDestinosExtra: []` y un warn: así el principal sigue yendo a SU Shop, sin caer al par
//      histórico de envs (que podría pegar al Shop equivocado);
//   3. si también falla, la fila vacía y rige el par histórico de envs (lo de antes de 0084).

import type { FilaShop } from "@/lib/shop-destino"

const FILA_VACIA: FilaShop = { shopUrl: "", shopInternalUrl: "" }

function nombreError(err: unknown): string {
  return err instanceof Error ? err.name : "error"
}

export async function leerFilaShop(tenantId: string): Promise<FilaShop> {
  let db: Awaited<ReturnType<typeof cargar>>
  try {
    db = await cargar()
  } catch (err) {
    console.warn(`[shop-destino] no se pudo leer la URL del Shop de ${tenantId}: ${nombreError(err)}`)
    return FILA_VACIA
  }
  const { getDb, tenants, eq } = db

  try {
    const [row] = await getDb()
      .select({
        shopUrl: tenants.shopUrl,
        shopInternalUrl: tenants.shopInternalUrl,
        shopDestinosExtra: tenants.shopDestinosExtra,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
    return row ?? FILA_VACIA
  } catch (err) {
    console.warn(
      `[shop-destino] no se pudieron leer los destinos extra de ${tenantId} (${nombreError(err)}): se usa solo el principal`,
    )
  }

  try {
    const [row] = await getDb()
      .select({ shopUrl: tenants.shopUrl, shopInternalUrl: tenants.shopInternalUrl })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
    return row ? { ...row, shopDestinosExtra: [] } : FILA_VACIA
  } catch (err) {
    console.warn(`[shop-destino] no se pudo leer la URL del Shop de ${tenantId}: ${nombreError(err)}`)
    return FILA_VACIA
  }
}

async function cargar() {
  const { getDb } = await import("@/db")
  const { tenants } = await import("@/db/schema")
  const { eq } = await import("drizzle-orm")
  return { getDb, tenants, eq }
}
