import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProyeccion, catalogSpecs, plataformaEntregas, plataformaSyncEstado } from "@/db/schema"

// Único escritor de las tablas de proyección (0090). Lo llama el receptor de eventos; nadie más.

/** Cursor compuesto de productos: synced_at es único por lote, el alegra_id desempata. */
export interface CursorProductos { at: Date; clave: string }

/** true si la entrega es nueva; false si ya se procesó (idempotencia por X-Platform-Delivery). */
export async function registrarEntrega(tenantId: string, deliveryId: string, eventId: string, action: string): Promise<boolean> {
  const res = await getDb().insert(plataformaEntregas).values({ tenantId, deliveryId, eventId, action }).onConflictDoNothing().returning({ id: plataformaEntregas.deliveryId })
  return res.length > 0
}

/** Merge "gana updated_at mayor": una entrega vieja (reintento, reenvío, desorden) no pisa una más nueva. */
export async function upsertProyeccion(tenantId: string, spec: string, externalKey: string, instanceId: string, data: Record<string, unknown>, updatedAt: Date): Promise<"escrita" | "vieja"> {
  const res = await getDb().insert(catalogProyeccion)
    .values({ tenantId, spec, externalKey, instanceId, data, updatedAt })
    .onConflictDoUpdate({
      target: [catalogProyeccion.tenantId, catalogProyeccion.spec, catalogProyeccion.externalKey],
      set: { instanceId: sql`excluded.instance_id`, data: sql`excluded.data`, updatedAt: sql`excluded.updated_at`, recibidoAt: sql`now()` },
      setWhere: sql`excluded.updated_at > "catalog_proyeccion"."updated_at"`,
    })
    .returning({ k: catalogProyeccion.externalKey })
  return res.length ? "escrita" : "vieja"
}

export async function upsertSpecProyectada(tenantId: string, slug: string, version: number, document: Record<string, unknown>): Promise<void> {
  await getDb().insert(catalogSpecs).values({ tenantId, slug, version, document })
    .onConflictDoUpdate({ target: [catalogSpecs.tenantId, catalogSpecs.slug], set: { version: sql`excluded.version`, document: sql`excluded.document`, recibidoAt: sql`now()` } })
}

export async function leerCursorProductos(tenantId: string): Promise<CursorProductos> {
  const [fila] = await getDb().select({ at: plataformaSyncEstado.productosCursor, clave: plataformaSyncEstado.productosCursorClave }).from(plataformaSyncEstado).where(eq(plataformaSyncEstado.tenantId, tenantId))
  return fila ?? { at: new Date(0), clave: "" }
}

export async function guardarCursorProductos(tenantId: string, cursor: CursorProductos): Promise<void> {
  await getDb().insert(plataformaSyncEstado).values({ tenantId, productosCursor: cursor.at, productosCursorClave: cursor.clave })
    .onConflictDoUpdate({ target: plataformaSyncEstado.tenantId, set: { productosCursor: cursor.at, productosCursorClave: cursor.clave, updatedAt: sql`now()` } })
}

export async function leerSpecProyectada(tenantId: string, slug: string): Promise<Record<string, unknown> | null> {
  const [fila] = await getDb().select({ d: catalogSpecs.document }).from(catalogSpecs).where(and(eq(catalogSpecs.tenantId, tenantId), eq(catalogSpecs.slug, slug)))
  return fila?.d ?? null
}
