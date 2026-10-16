import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { catalogProyeccion, catalogSpecs, plataformaEntregas, plataformaSyncEstado } from "@/db/schema"

// Único módulo que escribe las tablas de proyección (0090). Lo llama el receptor de eventos y, para
// `catalog_specs`, también la sincronización inicial (scripts/plataforma-sincronizar-specs.ts, vía
// lib/plataforma-specs.ts): dos escritores equivalentes de esa tabla, ambos por upsertSpecProyectada.

/** Cursor compuesto de productos: synced_at es único por lote, el alegra_id desempata. */
export interface CursorProductos { at: Date; clave: string }

/** true si la entrega es nueva; false si ya se procesó (idempotencia por X-Platform-Delivery). */
export async function registrarEntrega(tenantId: string, deliveryId: string, eventId: string, action: string): Promise<boolean> {
  const res = await getDb().insert(plataformaEntregas).values({ tenantId, deliveryId, eventId, action }).onConflictDoNothing().returning({ id: plataformaEntregas.deliveryId })
  return res.length > 0
}

/** Deshace registrarEntrega cuando la escritura falló, para que el reintento de la plataforma no se tome por repetido. */
export async function olvidarEntrega(tenantId: string, deliveryId: string): Promise<void> {
  await getDb().delete(plataformaEntregas).where(and(eq(plataformaEntregas.tenantId, tenantId), eq(plataformaEntregas.deliveryId, deliveryId)))
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

export async function upsertSpecProyectada(tenantId: string, slug: string, version: number, document: Record<string, unknown>): Promise<"escrita" | "vieja"> {
  // Una versión menor nunca reemplaza a una mayor (la firma no cubre X-Platform-Delivery: un reenvío
  // de un documento viejo con otro delivery id no debe pisar el nuevo). Igual versión se reescribe.
  const res = await getDb().insert(catalogSpecs).values({ tenantId, slug, version, document })
    .onConflictDoUpdate({
      target: [catalogSpecs.tenantId, catalogSpecs.slug],
      set: { version: sql`excluded.version`, document: sql`excluded.document`, recibidoAt: sql`now()` },
      setWhere: sql`excluded.version >= "catalog_specs"."version"`,
    })
    .returning({ slug: catalogSpecs.slug })
  return res.length > 0 ? "escrita" : "vieja"
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
