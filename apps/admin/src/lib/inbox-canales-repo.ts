import { and, eq, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { inboxCanales } from "@/db/schema"

export async function listarNombres(tenantId: string): Promise<Record<string, string>> {
  const rows = await getDb()
    .select({ k: inboxCanales.channelAccountId, nombre: inboxCanales.nombre })
    .from(inboxCanales)
    .where(eq(inboxCanales.tenantId, tenantId))
  return Object.fromEntries(rows.map((r) => [r.k, r.nombre]))
}

/** Upsert de los nombres no vacíos; los vacíos borran el nombre. */
export async function guardarNombres(tenantId: string, nombres: Record<string, string>): Promise<void> {
  const db = getDb()
  const conNombre = Object.entries(nombres).filter(([, n]) => n)
  const sinNombre = Object.entries(nombres).filter(([, n]) => !n).map(([k]) => k)
  for (const [k, nombre] of conNombre) {
    await db
      .insert(inboxCanales)
      .values({ tenantId, channelAccountId: k, nombre })
      .onConflictDoUpdate({
        target: [inboxCanales.tenantId, inboxCanales.channelAccountId],
        set: { nombre, updatedAt: new Date() },
      })
  }
  if (sinNombre.length) {
    await db.delete(inboxCanales).where(and(eq(inboxCanales.tenantId, tenantId), inArray(inboxCanales.channelAccountId, sinNombre)))
  }
}
