import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm"
import { getDb } from "@/db"
import { shopOrders, shopOrderItems, type ShopOrderItemRow, type ShopOrderRow } from "@/db/shop-schema"
import type { EstadoPedido } from "@/lib/pedidos-transiciones"

// Acceso a los pedidos del Shop (`shop.orders` / `shop.order_items`) desde el CRM.
//
// Reglas de este archivo:
//  - `tenantId` es SIEMPRE el primer argumento y entra en el WHERE de TODA consulta. Las dos
//    apps comparten base: sin ese filtro un tenant vería los pedidos de otro. El valor lo pone
//    el guard (host verificado), nunca el request.
//  - Sólo core builder (`db.select().from(shopOrders)`), nunca `db.query.*`: estas tablas no
//    están en el `schema` del cliente a propósito (ver el encabezado de shop-schema.ts).
//  - Lo ÚNICO que el CRM escribe de un pedido es el estado, el motivo de cancelación y la
//    auditoría del cambio. Totales, pago, snapshot del cliente e ítems son del Shop.

export const PEDIDOS_DEFAULT_LIMIT = 25
export const PEDIDOS_MAX_LIMIT = 50

export type PedidoRow = ShopOrderRow
export type PedidoItemRow = ShopOrderItemRow

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ListarPedidosFiltro {
  /** "todos" (o ausente) = sin filtro. */
  estado?: EstadoPedido | "todos"
  start?: number
  /** Default PEDIDOS_DEFAULT_LIMIT, máximo PEDIDOS_MAX_LIMIT. */
  limit?: number
}

export async function listarPedidos(
  tenantId: string,
  filtro: ListarPedidosFiltro = {},
): Promise<{ items: PedidoRow[]; total: number }> {
  const start = Math.max(0, Math.trunc(filtro.start ?? 0))
  const limit = Math.min(PEDIDOS_MAX_LIMIT, Math.max(1, Math.trunc(filtro.limit ?? PEDIDOS_DEFAULT_LIMIT)))

  const conditions: SQL[] = [eq(shopOrders.tenantId, tenantId)]
  if (filtro.estado && filtro.estado !== "todos") conditions.push(eq(shopOrders.estado, filtro.estado))
  const where = and(...conditions)

  // Mismo patrón que el listado de comprobantes: página + count en paralelo. El desempate por
  // id hace que la paginación sea estable cuando dos pedidos comparten `created_at`.
  const [items, count] = await Promise.all([
    getDb()
      .select()
      .from(shopOrders)
      .where(where)
      .orderBy(desc(shopOrders.createdAt), desc(shopOrders.id))
      .limit(limit)
      .offset(start),
    getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(shopOrders)
      .where(where),
  ])
  return { items, total: count[0]?.count ?? 0 }
}

async function itemsDe(orderId: string): Promise<PedidoItemRow[]> {
  // Orden determinístico para que el detalle no "baile" entre cargas. `order_items` no tiene
  // fecha ni posición; nombre + id alcanza.
  return getDb()
    .select()
    .from(shopOrderItems)
    .where(eq(shopOrderItems.orderId, orderId))
    .orderBy(asc(shopOrderItems.name), asc(shopOrderItems.id))
}

/**
 * Detalle. `null` = no existe, es de OTRO tenant, o el id no es un uuid: la ruta traduce los
 * tres al mismo 404. El formato se valida ANTES de consultar porque Postgres contesta un id
 * malformado con el error 22P02, que terminaría en un 500.
 */
export async function getPedido(
  tenantId: string,
  id: string,
): Promise<{ pedido: PedidoRow; items: PedidoItemRow[] } | null> {
  if (!UUID_RE.test(id)) return null
  const [pedido] = await getDb()
    .select()
    .from(shopOrders)
    .where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.id, id)))
  if (!pedido) return null
  // Los ítems se piden DESPUÉS de confirmar que el pedido es de este tenant.
  return { pedido, items: await itemsDe(pedido.id) }
}

export interface CambiarEstadoInput {
  /** El estado que el operador tenía en pantalla. Es la condición del UPDATE. */
  esperado: EstadoPedido
  nuevo: EstadoPedido
  /** Ya recortado y validado por la ruta. Sólo se guarda si `nuevo === "cancelado"`. */
  motivo: string | null
  /** Del guard (fila fresca de admin_users), nunca del body. */
  actor: { id: string; name: string }
  now: Date
}

export type CambiarEstadoResult =
  | { kind: "ok"; pedido: PedidoRow; items: PedidoItemRow[] }
  | { kind: "not_found" }
  | { kind: "conflict"; actual: EstadoPedido }

/**
 * Cambia el estado con concurrencia optimista. NO valida la tabla de transiciones (eso es de
 * la ruta, que tiene que contestar 422 antes de tocar la base).
 *
 * Es UN solo UPDATE condicional: `WHERE id AND tenant_id AND estado = esperado`. Ese WHERE es
 * el lock — si dos operadores mandan a la vez, Postgres serializa los dos UPDATE sobre la
 * fila y el segundo ya no matchea `estado = esperado`, así que afecta 0 filas. Sin
 * transacción ni SELECT FOR UPDATE. El motivo viaja en el MISMO statement que el estado: o se
 * guardan los dos o ninguno.
 */
export async function cambiarEstado(
  tenantId: string,
  id: string,
  input: CambiarEstadoInput,
): Promise<CambiarEstadoResult> {
  if (!UUID_RE.test(id)) return { kind: "not_found" }
  // Error de programación, no de usuario: la ruta ya devolvió 422 si faltaba. La última red
  // es el CHECK `orders_cancelacion_motivo_check` de la base.
  if (input.nuevo === "cancelado" && !input.motivo) {
    throw new Error("cambiarEstado: cancelar exige motivo")
  }

  const [actualizado] = await getDb()
    .update(shopOrders)
    .set({
      estado: input.nuevo,
      // En cualquier transición que no cancela la columna NO se toca (ni se pisa con null).
      ...(input.nuevo === "cancelado" ? { cancelacionMotivo: input.motivo } : {}),
      estadoActualizadoEn: input.now,
      estadoActualizadoPor: input.actor.id,
      estadoActualizadoPorNombre: input.actor.name,
      updatedAt: input.now,
    })
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId), eq(shopOrders.estado, input.esperado)))
    .returning()

  if (actualizado) return { kind: "ok", pedido: actualizado, items: await itemsDe(actualizado.id) }

  // 0 filas: o no existe / es de otro tenant, o alguien lo movió primero. Se distingue con un
  // SELECT que TAMBIÉN filtra por tenant: un pedido ajeno nunca llega a ser "conflict".
  const [existente] = await getDb()
    .select({ estado: shopOrders.estado })
    .from(shopOrders)
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId)))
  if (!existente) return { kind: "not_found" }
  return { kind: "conflict", actual: existente.estado as EstadoPedido }
}

// ───────────────────────────── DTOs ─────────────────────────────

/** `numeric` de Postgres llega como string. */
const num = (v: string | null): number => (v == null ? 0 : Number(v))
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

/** Mismo formato visible que usa el Shop (`formatearNumero`): el cliente y el operador tienen
 *  que poder nombrar el pedido igual por teléfono. Se copia: las apps no comparten código. */
export function formatearNumeroPedido(numero: number): string {
  return `PED-${String(numero).padStart(8, "0")}`
}

export interface PedidoListaDto {
  id: string
  numero: string
  creadoEn: string
  estado: EstadoPedido
  contactoNombre: string
  clienteRazonSocial: string | null
  entregaTipo: string
  pagoMetodo: string
  pagoEstado: string
  total: number
  requiereRevision: boolean
}

export interface PedidoItemDto {
  id: string
  alegraItemId: string
  code: string | null
  name: string
  brand: string | null
  qty: number
  precioUnitario: number
  ivaPorcentaje: number
  subtotal: number
  iva: number
  total: number
}

export interface PedidoDetalleDto extends PedidoListaDto {
  cliente: { codigo: string | null; razonSocial: string | null; cuit: string | null; email: string | null }
  contacto: { nombre: string; telefono: string }
  entrega: { tipo: string; ciudad: string | null; direccion: string | null }
  facturacion: {
    tipoDoc: string | null
    nroDoc: string | null
    razonSocial: string | null
    condicionIva: string | null
    domicilio: string | null
  }
  subtotal: number
  iva: number
  costoEnvio: number
  /** Aclaración que escribió el CLIENTE en el checkout. */
  notas: string | null
  /** Dato INTERNO del CRM: el Shop nunca lo muestra. */
  cancelacionMotivo: string | null
  estadoActualizadoEn: string | null
  estadoActualizadoPor: string | null
  estadoActualizadoPorNombre: string | null
  actualizadoEn: string
  items: PedidoItemDto[]
}

// Los DTO se arman campo por campo (nunca `...row`): `tenant_id` y cualquier columna que se
// agregue al subset quedan afuera de la respuesta salvo que alguien las ponga acá a propósito.
export function toPedidoDto(row: PedidoRow): PedidoListaDto {
  return {
    id: row.id,
    numero: formatearNumeroPedido(row.numero),
    creadoEn: row.createdAt.toISOString(),
    estado: row.estado as EstadoPedido,
    contactoNombre: row.contactoNombre,
    clienteRazonSocial: row.clienteRazonSocial,
    entregaTipo: row.entregaTipo,
    pagoMetodo: row.pagoMetodo,
    pagoEstado: row.pagoEstado,
    total: num(row.total),
    requiereRevision: row.requiereRevision,
  }
}

function toItemDto(item: PedidoItemRow): PedidoItemDto {
  return {
    id: item.id,
    alegraItemId: item.alegraItemId,
    code: item.code,
    name: item.name,
    brand: item.brand,
    qty: num(item.qty),
    precioUnitario: num(item.precioUnitario),
    ivaPorcentaje: num(item.ivaPorcentaje),
    subtotal: num(item.subtotal),
    iva: num(item.iva),
    total: num(item.total),
  }
}

export function toPedidoDetalleDto(row: PedidoRow, items: PedidoItemRow[]): PedidoDetalleDto {
  return {
    ...toPedidoDto(row),
    cliente: {
      codigo: row.clienteCodigo,
      razonSocial: row.clienteRazonSocial,
      cuit: row.clienteCuit,
      email: row.clienteEmail,
    },
    contacto: { nombre: row.contactoNombre, telefono: row.contactoTelefono },
    entrega: { tipo: row.entregaTipo, ciudad: row.entregaCiudad, direccion: row.entregaDireccion },
    facturacion: {
      tipoDoc: row.facturacionTipoDoc,
      nroDoc: row.facturacionNroDoc,
      razonSocial: row.facturacionRazonSocial,
      condicionIva: row.facturacionCondicionIva,
      domicilio: row.facturacionDomicilio,
    },
    subtotal: num(row.subtotal),
    iva: num(row.iva),
    costoEnvio: num(row.costoEnvio),
    notas: row.notas,
    cancelacionMotivo: row.cancelacionMotivo,
    estadoActualizadoEn: iso(row.estadoActualizadoEn),
    estadoActualizadoPor: row.estadoActualizadoPor,
    estadoActualizadoPorNombre: row.estadoActualizadoPorNombre,
    actualizadoEn: row.updatedAt.toISOString(),
    items: items.map(toItemDto),
  }
}
