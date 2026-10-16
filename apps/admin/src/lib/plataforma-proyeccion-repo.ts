import { and, eq, sql } from "drizzle-orm"
import { getDb, type Db } from "@/db"
import { catalogProyeccion, catalogSpecs, plataformaEntregas, plataformaSyncEstado } from "@/db/schema"

// Único módulo que escribe las tablas de proyección (0090). Lo llama el receptor de eventos y, para
// `catalog_specs`, también la sincronización inicial (scripts/plataforma-sincronizar-specs.ts, vía
// lib/plataforma-specs.ts): dos escritores equivalentes de esa tabla, ambos por upsertSpecProyectada.

/** Cursor compuesto de productos: synced_at es único por lote, el alegra_id desempata. */
export interface CursorProductos { at: Date; clave: string }

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
/** La base o una transacción abierta: el receptor registra la entrega y escribe en UNA transacción. */
export type Ejecutor = Db | Tx

/** Corre `fn` en una transacción: si tira, se deshace todo (la entrega registrada incluida). */
export function enTransaccion<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(fn)
}

/**
 * true si la entrega es nueva; false si ya se procesó (idempotencia por X-Platform-Delivery).
 * Dentro de la transacción del receptor: si la escritura que sigue falla, el registro se deshace con
 * ella y el reintento de la plataforma (mismo delivery id) se procesa. Dos entregas iguales en
 * paralelo: la segunda espera el commit de la primera en el ON CONFLICT y sale "repetida".
 */
export async function registrarEntrega(tenantId: string, deliveryId: string, eventId: string, action: string, db: Ejecutor = getDb()): Promise<boolean> {
  const res = await db.insert(plataformaEntregas).values({ tenantId, deliveryId, eventId, action }).onConflictDoNothing().returning({ id: plataformaEntregas.deliveryId })
  return res.length > 0
}

/** Merge "gana updated_at mayor": una entrega vieja (reintento, reenvío, desorden) no pisa una más nueva. */
export async function upsertProyeccion(tenantId: string, spec: string, externalKey: string, instanceId: string, data: Record<string, unknown>, updatedAt: Date, db: Ejecutor = getDb()): Promise<"escrita" | "vieja"> {
  const res = await db.insert(catalogProyeccion)
    .values({ tenantId, spec, externalKey, instanceId, data, updatedAt })
    .onConflictDoUpdate({
      target: [catalogProyeccion.tenantId, catalogProyeccion.spec, catalogProyeccion.externalKey],
      set: { instanceId: sql`excluded.instance_id`, data: sql`excluded.data`, updatedAt: sql`excluded.updated_at`, recibidoAt: sql`now()` },
      setWhere: sql`excluded.updated_at > "catalog_proyeccion"."updated_at"`,
    })
    .returning({ k: catalogProyeccion.externalKey })
  return res.length ? "escrita" : "vieja"
}

export async function upsertSpecProyectada(tenantId: string, slug: string, version: number, document: Record<string, unknown>, db: Ejecutor = getDb()): Promise<"escrita" | "vieja"> {
  // Una versión menor nunca reemplaza a una mayor (la firma no cubre X-Platform-Delivery: un reenvío
  // de un documento viejo con otro delivery id no debe pisar el nuevo). Igual versión se reescribe.
  const res = await db.insert(catalogSpecs).values({ tenantId, slug, version, document })
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
