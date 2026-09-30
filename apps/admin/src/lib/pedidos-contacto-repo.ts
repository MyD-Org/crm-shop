import { sql, type SQL } from "drizzle-orm"
import { getDb } from "@/db"
import { contactoDisponible } from "@/lib/shop-columnas"
import { estaSinContactar } from "@/lib/pedido-contacto"
import { leerReglasVenta } from "@/lib/reglas-venta-repo"

// Contacto de los pedidos pendientes (change `sucursales-igz-mdp`, rebanada B). Las columnas
// `contactado_en/por/nombre` son de la migración 0024 del Shop: se leen y escriben con SQL puro
// guardado por `contactoDisponible()` (ver `shop-columnas.ts`). Si la migración todavía no está
// aplicada, todo degrada sin error: nada figura "sin contactar" y marcar devuelve `no_disponible`.
// TODO(sucursales-igz-mdp B): pasar a drizzle cuando `shop-schema.ts` declare las columnas.

// El SQL puro devuelve los timestamptz como texto ISO (drizzle desactiva el parseo de fechas).
const aFecha = (v: Date | string | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface EstadoContacto {
  /** Las columnas del Shop existen. */
  disponible: boolean
  /** Horas del aviso "sin contactar" (0 = aviso apagado). */
  umbralHoras: number
}

export async function estadoContacto(tenantId: string): Promise<EstadoContacto> {
  const [disponible, reglas] = await Promise.all([contactoDisponible(), leerReglasVenta(tenantId)])
  return { disponible, umbralHoras: reglas.avisoSinContactarHoras }
}

/**
 * Predicado SQL de "pendiente sin contactar hace más de N horas" sobre `shop.orders` (sin alias).
 * Solo se puede usar con `disponible` y `umbralHoras > 0`; si no, `false` constante.
 */
export function predicadoSinContactar(estado: EstadoContacto): SQL {
  if (!estado.disponible || estado.umbralHoras <= 0) return sql`false`
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
  if (validos.length === 0 || !(await contactoDisponible())) return salida
  const filas = await getDb().execute(sql`
    select id, contactado_en, contactado_por_nombre from shop.orders
    where tenant_id = ${tenantId} and id in (${sql.join(validos.map((i) => sql`${i}::uuid`), sql`, `)})
  `)
  for (const f of filas as unknown as { id: string; contactado_en: Date | string | null; contactado_por_nombre: string | null }[]) {
    salida.set(f.id, { contactadoEn: aFecha(f.contactado_en), contactadoPorNombre: f.contactado_por_nombre })
  }
  return salida
}

export type ResultadoContacto =
  | { kind: "ok"; contactadoEn: Date; contactadoPorNombre: string }
  | { kind: "not_found" }
  | { kind: "ya_contactado"; contactadoEn: Date; contactadoPorNombre: string | null }
  | { kind: "cancelado" }
  | { kind: "no_disponible" }

/** "Marcar contactado": una sola vez (el primer contacto manda; repetirlo no lo pisa). */
export async function marcarContactado(
  tenantId: string,
  id: string,
  actor: { id: string; name: string },
  now: Date = new Date(),
): Promise<ResultadoContacto> {
  if (!UUID_RE.test(id)) return { kind: "not_found" }
  if (!(await contactoDisponible())) return { kind: "no_disponible" }

  const db = getDb()
  const filas = await db.execute(sql`
    update shop.orders
    set contactado_en = ${now.toISOString()}::timestamptz, contactado_por = ${actor.id}::uuid,
        contactado_por_nombre = ${actor.name}, updated_at = ${now.toISOString()}::timestamptz
    where id = ${id}::uuid and tenant_id = ${tenantId} and contactado_en is null and estado <> 'cancelado'
    returning contactado_en
  `)
  if (filas.length > 0) return { kind: "ok", contactadoEn: now, contactadoPorNombre: actor.name }

  const [actual] = (await db.execute(sql`
    select estado, contactado_en, contactado_por_nombre from shop.orders
    where id = ${id}::uuid and tenant_id = ${tenantId}
  `)) as unknown as { estado: string; contactado_en: Date | null; contactado_por_nombre: string | null }[]
  if (!actual) return { kind: "not_found" }
  if (actual.contactado_en) {
    return { kind: "ya_contactado", contactadoEn: aFecha(actual.contactado_en)!, contactadoPorNombre: actual.contactado_por_nombre }
  }
  return { kind: "cancelado" }
}

/**
 * Suma a cada pedido del listado si está "sin contactar" y cuándo se contactó. Devuelve además el
 * estado del aviso (`contacto`) para que la UI sepa si mostrar la cola y la acción.
 */
export async function enriquecerConContacto<T extends { id: string; estado: string; creadoEn: string }>(
  tenantId: string,
  items: T[],
  now: Date = new Date(),
): Promise<{ items: (T & { sinContactar: boolean; contactadoEn: string | null })[]; contacto: EstadoContacto }> {
  const contacto = await estadoContacto(tenantId)
  const mapa = contacto.disponible ? await contactoDe(tenantId, items.map((i) => i.id)) : new Map<string, ContactoPedido>()
  return {
    contacto,
    items: items.map((i) => {
      const c = mapa.get(i.id)
      const contactadoEn = c?.contactadoEn ?? null
      return {
        ...i,
        contactadoEn: contactadoEn ? contactadoEn.toISOString() : null,
        sinContactar: contacto.disponible && estaSinContactar({ estado: i.estado, creadoEn: new Date(i.creadoEn), contactadoEn }, contacto.umbralHoras, now),
      }
    }),
  }
}
