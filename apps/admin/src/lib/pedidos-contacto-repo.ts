import { and, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm"
import { getDb } from "@/db"
import { shopOrders } from "@/db/shop-schema"
import { estaSinContactar } from "@/lib/pedido-contacto"
import { leerReglasVenta } from "@/lib/reglas-venta-repo"

// Contacto de los pedidos pendientes (change `sucursales-igz-mdp`, rebanada B). Las columnas
// `contactado_en/por/nombre` son de la migración 0024 del Shop y están declaradas en
// `shop-schema.ts`.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface EstadoContacto {
  /** Horas del aviso "sin contactar" (0 = aviso apagado). */
  umbralHoras: number
}

export async function estadoContacto(tenantId: string): Promise<EstadoContacto> {
  const reglas = await leerReglasVenta(tenantId)
  return { umbralHoras: reglas.avisoSinContactarHoras }
}

/**
 * Predicado SQL de "pendiente sin contactar hace más de N horas" sobre `shop.orders` (sin alias).
 * Con `umbralHoras <= 0` (aviso apagado) es `false` constante.
 */
export function predicadoSinContactar(estado: EstadoContacto): SQL {
  if (estado.umbralHoras <= 0) return sql`false`
  return sql`("estado" = 'pendiente' AND "contactado_en" IS NULL AND "created_at" < now() - make_interval(hours => ${estado.umbralHoras}))`
}

export interface ContactoPedido {
  contactadoEn: Date | null
  contactadoPorNombre: string | null
}

/** Estado de contacto de varios pedidos del tenant (los ids que no existan no figuran). */
export async function contactoDe(tenantId: string, ids: string[]): Promise<Map<string, ContactoPedido>> {
  const salida = new Map<string, ContactoPedido>()
  const validos = ids.filter((i) => UUID_RE.test(i))
  if (validos.length === 0) return salida
  const filas = await getDb()
    .select({ id: shopOrders.id, contactadoEn: shopOrders.contactadoEn, contactadoPorNombre: shopOrders.contactadoPorNombre })
    .from(shopOrders)
    .where(and(eq(shopOrders.tenantId, tenantId), inArray(shopOrders.id, validos)))
  for (const f of filas) salida.set(f.id, { contactadoEn: f.contactadoEn, contactadoPorNombre: f.contactadoPorNombre })
  return salida
}

export type ResultadoContacto =
  | { kind: "ok"; contactadoEn: Date; contactadoPorNombre: string }
  | { kind: "not_found" }
  | { kind: "ya_contactado"; contactadoEn: Date; contactadoPorNombre: string | null }
  | { kind: "cancelado" }

/** "Marcar contactado": una sola vez (el primer contacto manda; repetirlo no lo pisa). */
export async function marcarContactado(
  tenantId: string,
  id: string,
  actor: { id: string; name: string },
  now: Date = new Date(),
): Promise<ResultadoContacto> {
  if (!UUID_RE.test(id)) return { kind: "not_found" }

  const db = getDb()
  const filas = await db
    .update(shopOrders)
    .set({ contactadoEn: now, contactadoPor: actor.id, contactadoPorNombre: actor.name, updatedAt: now })
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId), isNull(shopOrders.contactadoEn), ne(shopOrders.estado, "cancelado")))
    .returning({ id: shopOrders.id })
  if (filas.length > 0) return { kind: "ok", contactadoEn: now, contactadoPorNombre: actor.name }

  const [actual] = await db
    .select({ estado: shopOrders.estado, contactadoEn: shopOrders.contactadoEn, contactadoPorNombre: shopOrders.contactadoPorNombre })
    .from(shopOrders)
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId)))
  if (!actual) return { kind: "not_found" }
  if (actual.contactadoEn) {
    return { kind: "ya_contactado", contactadoEn: actual.contactadoEn, contactadoPorNombre: actual.contactadoPorNombre }
  }
  return { kind: "cancelado" }
}

/**
 * Suma a cada pedido del listado si está "sin contactar" y cuándo se contactó. Devuelve además el
 * estado del aviso (`contacto`) para que la UI sepa si mostrar la cola.
 */
export async function enriquecerConContacto<T extends { id: string; estado: string; creadoEn: string }>(
  tenantId: string,
  items: T[],
  now: Date = new Date(),
): Promise<{ items: (T & { sinContactar: boolean; contactadoEn: string | null })[]; contacto: EstadoContacto }> {
  const contacto = await estadoContacto(tenantId)
  const mapa = await contactoDe(tenantId, items.map((i) => i.id))
  return {
    contacto,
    items: items.map((i) => {
      const c = mapa.get(i.id)
      const contactadoEn = c?.contactadoEn ?? null
      return {
        ...i,
        contactadoEn: contactadoEn ? contactadoEn.toISOString() : null,
        sinContactar: estaSinContactar({ estado: i.estado, creadoEn: new Date(i.creadoEn), contactadoEn }, contacto.umbralHoras, now),
      }
    }),
  }
}
