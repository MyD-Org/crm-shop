import { and, asc, desc, eq, getTableColumns, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm"
import { getDb, type Db } from "@/db"
import { alegraContacts, catalogProducts } from "@/db/schema"
import {
  shopOrderEventos,
  shopOrderRemitos,
  shopOrders,
  shopOrderItems,
  type ShopOrderEventoRow,
  type ShopOrderItemRow,
  type ShopOrderRemitoRow,
  type ShopOrderRow,
} from "@/db/shop-schema"
import { CUENTA_ALEGRA_PRINCIPAL } from "@/lib/alegra-contacts-repo"
import { limpiarFacturaCuenta } from "@/lib/pedido-factura-cuenta-repo"
import { estadoContacto, predicadoSinContactar } from "@/lib/pedidos-contacto-repo"
import { reservaDePendiente, type ReservaPedido } from "@/lib/pedido-reserva"
import type { ReglaAplicada } from "@/lib/sucursales-zona"
import type { EntregaTipo, EstadoPedido } from "@/lib/pedidos-transiciones"

// Ejecutor de consultas: `getDb()` fuera de una transacción, o el `tx` que da `db.transaction`
// dentro de una. Todas las escrituras de este archivo que insertan un evento van adentro de una
// transacción con su UPDATE: o se guardan los dos, o ninguno.
type Ejecutor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0]

// Acceso a los pedidos del Shop (`shop.orders` / `shop.order_items`) desde el CRM.
//
// Reglas de este archivo:
//  - `tenantId` es SIEMPRE el primer argumento y entra en el WHERE de TODA consulta. Las dos
//    apps comparten base: sin ese filtro un tenant vería los pedidos de otro. El valor lo pone
//    el guard (host verificado), nunca el request.
//  - Sólo core builder (`db.select().from(shopOrders)`), nunca `db.query.*`: estas tablas no
//    están en el `schema` del cliente a propósito (ver el encabezado de shop-schema.ts).
//  - Lo ÚNICO que el CRM escribe de un pedido es el estado, el motivo de cancelación, la
//    factura vinculada con su marca de facturado (`factura_*` + `facturado_*`) y la auditoría
//    de esos cambios. Totales, pago, snapshot del cliente e ítems son del Shop.

export const PEDIDOS_DEFAULT_LIMIT = 25
export const PEDIDOS_MAX_LIMIT = 50

export type PedidoRow = ShopOrderRow
export type PedidoItemRow = ShopOrderItemRow
export type RemitoRow = ShopOrderRemitoRow

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Valor sentinela de `factura_alegra_id` mientras se reserva el pedido para emitir su factura
 * (ver la sección "Emisión de factura" más abajo, `reservarEmisionFactura`). Nunca es un id real
 * de Alegra (los ids de Alegra son numéricos). Se define acá arriba porque además de la emisión
 * la usan `condicionCola`/`toPedidoDto`/`toPedidoDetalleDto`: un pedido reservado (vigente o
 * colgado) NO cuenta como facturado para el badge, las colas ni el DTO que ve el Shop.
 */
export const RESERVA_EMISION_SENTINEL = "__reservando_emision__"

/**
 * Cuánto puede durar una reserva antes de considerarse abandonada (la función que la creó murió
 * a mitad de camino: timeout de Vercel, crash, deploy — nunca llegó a llamar
 * `liberarReservaEmisionFactura` ni `persistirFacturaEmitida`). Tiene que superar con margen
 * amplio el `maxDuration` de la ruta de emisión (60s, ver `factura/emitir/route.ts`): 5 minutos
 * es bastante más que cualquier timeout de función esperable, y bastante menos que "para
 * siempre" (que es lo que pasaba antes de este fix).
 */
export const RESERVA_EMISION_TTL_MINUTOS = 5

/**
 * ¿En qué estado está la reserva de emisión de este pedido? `null` = no hay reserva (el pedido no
 * tiene factura, o ya tiene una factura REAL persistida — no un sentinel). Sólo tiene sentido
 * cuando `facturaAlegraId === RESERVA_EMISION_SENTINEL`.
 */
export function estadoReservaEmision(
  pedido: Pick<PedidoRow, "facturaAlegraId" | "facturadoEn">,
  now: Date = new Date(),
): "vigente" | "vencida" | null {
  if (pedido.facturaAlegraId !== RESERVA_EMISION_SENTINEL) return null
  const antiguedadMs = pedido.facturadoEn ? now.getTime() - pedido.facturadoEn.getTime() : Infinity
  return antiguedadMs > RESERVA_EMISION_TTL_MINUTOS * 60_000 ? "vencida" : "vigente"
}

/**
 * `WHERE` que trata como "libre para reservar/vincular" tanto un pedido sin factura como uno con
 * una reserva de emisión VENCIDA (ver `estadoReservaEmision`). La usan `reservarEmisionFactura` y
 * `vincularFactura`: si la función que reservó murió a mitad de camino, tanto "Emitir" como
 * "Vincular" tienen que poder retomar el pedido en vez de quedar bloqueados para siempre.
 */
function reservaEmisionLibre(): SQL {
  return or(
    isNull(shopOrders.facturaAlegraId),
    and(
      eq(shopOrders.facturaAlegraId, RESERVA_EMISION_SENTINEL),
      sql`${shopOrders.facturadoEn} < now() - make_interval(mins => ${RESERVA_EMISION_TTL_MINUTOS})`,
    )!,
  )!
}

/** Las cuatro colas de "cosas para revisar" del tablero. Cada una es un predicado fijo, siempre
 *  sobre el tenant completo (nunca sobre los filtros que el operador tenga puestos). */
export type Cola = "sin_confirmar" | "pago" | "datos" | "sin_factura" | "sin_contactar"

export interface ListarPedidosFiltro {
  /** "todos" (o ausente) = sin filtro. */
  estado?: EstadoPedido | "todos"
  /** Número (con o sin "PED-"/ceros), nombre de contacto, razón social o email. */
  q?: string
  entrega?: EntregaTipo
  pago?: "pagado" | "pendiente"
  cola?: Cola
  /** Slug de sucursal (`shop.orders.sucursal`); ausente = todas. La ruta valida que exista. */
  sucursal?: string
  start?: number
  /** Default PEDIDOS_DEFAULT_LIMIT, máximo PEDIDOS_MAX_LIMIT. Se ignora si `vista === "tablero"`. */
  limit?: number
  /** "tablero": no cancelados + entregados de los últimos 7 días, sin paginar, tope 300. */
  vista?: "tablero"
}

export interface ColasCounts {
  sin_confirmar: number
  pago: number
  datos: number
  sin_factura: number
  /** Pendientes sin contactar tras el umbral de las reglas de venta; 0 si el aviso está apagado. */
  sin_contactar: number
}

const COLAS_VACIAS: ColasCounts = { sin_confirmar: 0, pago: 0, datos: 0, sin_factura: 0, sin_contactar: 0 }

/** El mismo predicado que ve el operador al elegir cada cola (usado también para `colas`, con
 *  FILTER, y para `filtro.cola`, en el WHERE). */
function condicionCola(cola: Cola, sinContactar: SQL = sql`false`): SQL {
  switch (cola) {
    case "sin_confirmar":
      return eq(shopOrders.estado, "pendiente")
    case "pago":
      return isNotNull(shopOrders.pagoRevision)
    case "datos":
      return and(eq(shopOrders.requiereRevision, true), ne(shopOrders.estado, "cancelado"))!
    case "sin_contactar":
      // El predicado lo arma `predicadoSinContactar` (necesita el umbral de las reglas de venta);
      // con el aviso apagado es `false` y la cola queda vacía.
      return sinContactar
    case "sin_factura":
      // `facturado_en` no alcanza sola: mientras el pedido tiene una reserva de emisión puesta
      // (`factura_alegra_id = RESERVA_EMISION_SENTINEL`, ver la sección de emisión más abajo),
      // `facturado_en` YA está seteado (lo exige un CHECK de la base) aunque todavía no haya
      // factura real — vigente o colgada, cuenta como "sin factura" para esta cola.
      return and(
        eq(shopOrders.estado, "entregado"),
        or(isNull(shopOrders.facturadoEn), eq(shopOrders.facturaAlegraId, RESERVA_EMISION_SENTINEL))!,
      )!
  }
}

const VENTANA_TABLERO = sql`interval '7 days'`

export const TABLERO_MAX_LIMIT = 300

export async function listarPedidos(
  tenantId: string,
  filtro: ListarPedidosFiltro = {},
): Promise<{ items: PedidoRow[]; total: number; colas: ColasCounts }> {
  const tenantWhere = eq(shopOrders.tenantId, tenantId)
  const sinContactar = predicadoSinContactar(await estadoContacto(tenantId))

  const conditions: SQL[] = [tenantWhere]
  if (filtro.estado && filtro.estado !== "todos") conditions.push(eq(shopOrders.estado, filtro.estado))
  if (filtro.entrega) conditions.push(eq(shopOrders.entregaTipo, filtro.entrega))
  if (filtro.pago) conditions.push(eq(shopOrders.pagoEstado, filtro.pago))
  if (filtro.cola) conditions.push(condicionCola(filtro.cola, sinContactar))
  if (filtro.sucursal) conditions.push(eq(shopOrders.sucursal, filtro.sucursal))
  if (filtro.vista === "tablero") {
    conditions.push(
      and(
        ne(shopOrders.estado, "cancelado"),
        or(ne(shopOrders.estado, "entregado"), sql`${shopOrders.estadoActualizadoEn} >= now() - ${VENTANA_TABLERO}`)!,
      )!,
    )
  }
  const q = filtro.q?.trim()
  if (q) {
    // El número se busca por texto (ILIKE), no por igualdad: "1000" matchea el pedido PED-
    // 00001000 sin que el operador tenga que tipear el prefijo ni los ceros, y "PED-00001000"
    // (o "ped-1000") matchea igual porque se compara también contra el número YA formateado.
    const soloDigitos = q.replace(/\D/g, "")
    const like = `%${q}%`
    const condiciones = [
      sql`unaccent(${shopOrders.contactoNombre}) ILIKE unaccent(${like})`,
      sql`unaccent(coalesce(${shopOrders.clienteRazonSocial}, '')) ILIKE unaccent(${like})`,
      sql`${shopOrders.clienteEmail} ILIKE ${like}`,
      sql`('PED-' || lpad(${shopOrders.numero}::text, 8, '0')) ILIKE ${like}`,
    ]
    if (soloDigitos) condiciones.push(sql`${shopOrders.numero}::text ILIKE ${`%${soloDigitos}%`}`)
    conditions.push(or(...condiciones)!)
  }
  const where = and(...conditions)!

  const limit = filtro.vista === "tablero" ? TABLERO_MAX_LIMIT : Math.min(PEDIDOS_MAX_LIMIT, Math.max(1, Math.trunc(filtro.limit ?? PEDIDOS_DEFAULT_LIMIT)))
  const start = filtro.vista === "tablero" ? 0 : Math.max(0, Math.trunc(filtro.start ?? 0))

  // Página + count + colas, en paralelo. El desempate por id hace que la paginación sea estable
  // cuando dos pedidos comparten `created_at`. Las colas cuentan SIEMPRE sobre el tenant entero,
  // sin los filtros de arriba: son la foto de "cuánto falta", no de la página actual.
  const [items, count, colasFila] = await Promise.all([
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
    getDb()
      .select({
        sinConfirmar: sql<number>`count(*) filter (where ${condicionCola("sin_confirmar")})::int`,
        pago: sql<number>`count(*) filter (where ${condicionCola("pago")})::int`,
        datos: sql<number>`count(*) filter (where ${condicionCola("datos")})::int`,
        sinFactura: sql<number>`count(*) filter (where ${condicionCola("sin_factura")})::int`,
        sinContactar: sql<number>`count(*) filter (where ${sinContactar})::int`,
      })
      .from(shopOrders)
      .where(tenantWhere),
  ])
  const colas: ColasCounts = colasFila[0]
    ? {
        sin_confirmar: colasFila[0].sinConfirmar,
        pago: colasFila[0].pago,
        datos: colasFila[0].datos,
        sin_factura: colasFila[0].sinFactura,
        sin_contactar: colasFila[0].sinContactar,
      }
    : COLAS_VACIAS
  return { items, total: count[0]?.count ?? 0, colas }
}

/**
 * Ítem del pedido más lo que HOY dice el espejo del catálogo (`catalog_products`) de ese mismo
 * producto, por `alegra_item_id`. Los dos son un snapshot de la última sync/webhook, no un dato
 * en vivo, y son `null` si el producto ya no está en el espejo:
 *  - `catalogoStock`: `catalog_products.stock`.
 *  - `catalogoCosto`: el "costo unitario" cargado en Alegra (`raw->inventory->unitCost`); el
 *    espejo no lo tiene en columna propia, sale del ítem completo que guarda `raw`.
 */
export type PedidoItemConCatalogo = PedidoItemRow & { catalogoStock: string | null; catalogoCosto: string | null }

async function itemsDe(tenantId: string, orderId: string): Promise<PedidoItemConCatalogo[]> {
  // Orden determinístico para que el detalle no "baile" entre cargas. `order_items` no tiene
  // fecha ni posición; nombre + id alcanza. El LEFT JOIN al espejo lleva el tenant en el ON:
  // `alegra_id` sólo es único por tenant (índice `cat_tenant_alegra`).
  return getDb()
    .select({
      ...getTableColumns(shopOrderItems),
      catalogoStock: catalogProducts.stock,
      catalogoCosto: sql<string | null>`${catalogProducts.raw}->'inventory'->>'unitCost'`,
    })
    .from(shopOrderItems)
    .leftJoin(
      catalogProducts,
      and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.alegraId, shopOrderItems.alegraItemId)),
    )
    .where(eq(shopOrderItems.orderId, orderId))
    .orderBy(asc(shopOrderItems.name), asc(shopOrderItems.id))
}

// ───────────────────────── Historial (shop.order_eventos, 0020 del Shop) ─────────────────────────

/** Los mismos 6 tipos que el CHECK `order_eventos_tipo_check` de la base, más `'creado'`, que
 *  nunca se guarda: se deriva de `orders.created_at` al leer (ver `historialDe`). */
export type EventoTipo =
  | "creado"
  | "estado"
  | "pago"
  | "factura_vinculada"
  | "factura_desvinculada"
  | "factura_emitida"
  | "cancelado"
  | "remito_emitido"
  | "remito_vinculado"
  | "remito_desvinculado"

export interface EventoHistorialDto {
  tipo: EventoTipo
  detalle: Record<string, unknown>
  actorNombre: string | null
  en: string
}

/** Inserta un evento del historial. SIEMPRE dentro de la misma transacción que el UPDATE que lo
 *  motiva (el `ejecutor` es el `tx`, nunca `getDb()` suelto, salvo que quien llama ya esté fuera
 *  de toda transacción a propósito). */
async function registrarEvento(
  ejecutor: Ejecutor,
  input: {
    tenantId: string
    orderId: string
    tipo: Exclude<EventoTipo, "creado">
    detalle: Record<string, unknown>
    actor: { id: string; name: string } | null
    now: Date
  },
): Promise<void> {
  await ejecutor.insert(shopOrderEventos).values({
    tenantId: input.tenantId,
    orderId: input.orderId,
    tipo: input.tipo,
    detalle: input.detalle,
    actorId: input.actor?.id ?? null,
    actorNombre: input.actor?.name ?? null,
    creadoEn: input.now,
  })
}

function toEventoDto(row: ShopOrderEventoRow): EventoHistorialDto {
  return {
    tipo: row.tipo as EventoTipo,
    detalle: row.detalle,
    actorNombre: row.actorNombre,
    en: row.creadoEn.toISOString(),
  }
}

/**
 * Historial completo de un pedido, del más nuevo al más viejo. El evento "creado" NUNCA está en
 * la tabla (ver el comentario de la migración 0020 del Shop): se agrega acá al final, con
 * `orders.created_at`, así que siempre aparece aunque el pedido no tenga ningún otro evento.
 */
async function historialDe(tenantId: string, orderId: string, creadoEnPedido: Date): Promise<EventoHistorialDto[]> {
  const eventos = await getDb()
    .select()
    .from(shopOrderEventos)
    .where(and(eq(shopOrderEventos.tenantId, tenantId), eq(shopOrderEventos.orderId, orderId)))
    .orderBy(desc(shopOrderEventos.creadoEn), desc(shopOrderEventos.id))
  return [
    ...eventos.map(toEventoDto),
    { tipo: "creado", detalle: {}, actorNombre: null, en: creadoEnPedido.toISOString() },
  ]
}

/**
 * Nombre de la lista de precios del contacto de Alegra con ese documento (sólo espejo, 0
 * requests; mismo desempate que el Shop: cliente primero, id numérico menor). Sólo para el
 * texto de `otra_lista_precios`; `null` si no hay fila o la lista no tiene nombre.
 */
export async function listaPreciosPorDocumento(tenantId: string, nroDoc: string | null): Promise<string | null> {
  const doc = (nroDoc ?? "").replace(/\D/g, "")
  if (!doc) return null
  const [fila] = await getDb()
    .select({ priceListName: alegraContacts.priceListName })
    .from(alegraContacts)
    .where(
      and(
        eq(alegraContacts.tenantId, tenantId),
        eq(alegraContacts.alegraAccount, CUENTA_ALEGRA_PRINCIPAL),
        eq(alegraContacts.status, "active"),
        eq(alegraContacts.identificationNorm, doc),
      ),
    )
    .orderBy(
      sql`('client' = ANY(${alegraContacts.types})) DESC`,
      sql`CASE WHEN ${alegraContacts.alegraId} ~ '^[0-9]+$' THEN ${alegraContacts.alegraId}::numeric END ASC NULLS LAST`,
      asc(alegraContacts.alegraId),
    )
    .limit(1)
  return fila?.priceListName?.trim() || null
}

/** Lo que el detalle suma a la fila: la lista del contacto, sólo si el motivo la nombra. */
async function listaParaRevision(tenantId: string, pedido: PedidoRow): Promise<string | null> {
  if (pedido.motivoRevision !== "otra_lista_precios") return null
  try {
    return await listaPreciosPorDocumento(tenantId, pedido.facturacionNroDoc)
  } catch (err) {
    // Es un adorno del texto: sin la lista, el aviso sale igual ("con otra lista de precios").
    const codigo = (err as { code?: unknown })?.code
    console.error(`[pedidos] no se pudo leer la lista del contacto (${codigo ?? "sin código"})`)
    return null
  }
}

export interface DetalleExtras {
  items: PedidoItemConCatalogo[]
  listaPrecios: string | null
  historial: EventoHistorialDto[]
  /** Remito único del pedido (0021 del Shop), o `null` si todavía no tiene. */
  remito: RemitoRow | null
}

/** El remito del pedido, si tiene (a lo sumo uno: unicidad de `order_id`, ver la migración 0021
 *  del Shop). */
async function remitoDe(tenantId: string, orderId: string): Promise<RemitoRow | null> {
  const [fila] = await getDb()
    .select()
    .from(shopOrderRemitos)
    .where(and(eq(shopOrderRemitos.tenantId, tenantId), eq(shopOrderRemitos.orderId, orderId)))
  return fila ?? null
}

/** Lo que el detalle suma a la fila, aparte de sus propias columnas: ítems, lista de precios (si
 *  aplica), historial y remito. Se piden en paralelo DESPUÉS de confirmar que el pedido es de ese tenant. */
async function detalleExtras(tenantId: string, pedido: PedidoRow): Promise<DetalleExtras> {
  const [items, listaPrecios, historial, remito] = await Promise.all([
    itemsDe(tenantId, pedido.id),
    listaParaRevision(tenantId, pedido),
    historialDe(tenantId, pedido.id, pedido.createdAt),
    remitoDe(tenantId, pedido.id),
  ])
  return { items, listaPrecios, historial, remito }
}

/**
 * Detalle. `null` = no existe, es de OTRO tenant, o el id no es un uuid: la ruta traduce los
 * tres al mismo 404. El formato se valida ANTES de consultar porque Postgres contesta un id
 * malformado con el error 22P02, que terminaría en un 500.
 */
export async function getPedido(
  tenantId: string,
  id: string,
): Promise<({ pedido: PedidoRow } & DetalleExtras) | null> {
  if (!UUID_RE.test(id)) return null
  const [pedido] = await getDb()
    .select()
    .from(shopOrders)
    .where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.id, id)))
  if (!pedido) return null
  const extras = await detalleExtras(tenantId, pedido)
  return { pedido, ...extras }
}

/**
 * Sólo el `entrega_tipo` (columna `text`, sin CHECK): el PATCH lo necesita para elegir la
 * tabla de transiciones ANTES de tocar el estado, sin traer el pedido entero. `null` = no
 * existe / es de otro tenant / id malformado (mismo criterio que `getPedido`); un valor que no
 * sea "retiro" ni "envio" (dato viejo o corrupto) se normaliza a "envio", la tabla sin
 * restricciones extra.
 */
export async function getEntregaTipoPedido(tenantId: string, id: string): Promise<EntregaTipo | null> {
  if (!UUID_RE.test(id)) return null
  const [row] = await getDb()
    .select({ entregaTipo: shopOrders.entregaTipo })
    .from(shopOrders)
    .where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.id, id)))
  if (!row) return null
  return row.entregaTipo === "retiro" ? "retiro" : "envio"
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
  | ({ kind: "ok"; pedido: PedidoRow } & DetalleExtras)
  | { kind: "not_found" }
  | { kind: "conflict"; actual: EstadoPedido }

/**
 * Cambia el estado con concurrencia optimista. NO valida la tabla de transiciones (eso es de
 * la ruta, que tiene que contestar 422 antes de tocar la base).
 *
 * Es UN solo UPDATE condicional: `WHERE id AND tenant_id AND estado = esperado`. Ese WHERE es
 * el lock — si dos operadores mandan a la vez, Postgres serializa los dos UPDATE sobre la
 * fila y el segundo ya no matchea `estado = esperado`, así que afecta 0 filas. El motivo viaja
 * en el MISMO statement que el estado: o se guardan los dos o ninguno.
 *
 * El UPDATE y el/los evento(s) del historial (`shop.order_eventos`) van en la MISMA transacción:
 * un cambio de estado exitoso siempre deja su rastro, y si el insert del evento fallara el
 * UPDATE se deshace con él. Cancelar deja DOS eventos ('estado' con el par desde/hacia, y
 * 'cancelado' con el motivo aparte): así el historial puede mostrar el motivo sin tener que leer
 * el detalle de un evento 'estado'.
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

  const actualizado = await getDb().transaction(async (tx) => {
    const [fila] = await tx
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
    if (!fila) return null

    await registrarEvento(tx, {
      tenantId,
      orderId: fila.id,
      tipo: "estado",
      detalle: { desde: input.esperado, hacia: input.nuevo },
      actor: input.actor,
      now: input.now,
    })
    if (input.nuevo === "cancelado") {
      await registrarEvento(tx, {
        tenantId,
        orderId: fila.id,
        tipo: "cancelado",
        detalle: { motivo: input.motivo },
        actor: input.actor,
        now: input.now,
      })
    }
    return fila
  })

  if (actualizado) {
    const extras = await detalleExtras(tenantId, actualizado)
    return { kind: "ok", pedido: actualizado, ...extras }
  }

  // 0 filas: o no existe / es de otro tenant, o alguien lo movió primero. Se distingue con un
  // SELECT que TAMBIÉN filtra por tenant: un pedido ajeno nunca llega a ser "conflict".
  const [existente] = await getDb()
    .select({ estado: shopOrders.estado })
    .from(shopOrders)
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId)))
  if (!existente) return { kind: "not_found" }
  return { kind: "conflict", actual: existente.estado as EstadoPedido }
}

// ───────────────────────── Factura vinculada ─────────────────────────

/** Lo que se guarda de la factura de Alegra al vincularla (copia de ese momento). */
export interface FacturaParaVincular {
  alegraId: string
  numero: string | null
  /** Emisión, YYYY-MM-DD. */
  fecha: string
  total: number
}

export type FacturaResult =
  | ({ kind: "ok"; pedido: PedidoRow } & DetalleExtras)
  | { kind: "not_found" }
  | { kind: "cancelado" }
  /** El pedido ya tiene OTRA factura (vincular) o no la que el operador tenía en pantalla (desvincular). */
  | { kind: "conflict" }

async function okConItems(tenantId: string, pedido: PedidoRow): Promise<FacturaResult> {
  const extras = await detalleExtras(tenantId, pedido)
  return { kind: "ok", pedido, ...extras }
}

/**
 * Vincula una factura de Alegra (ya leída y validada por la ruta) y marca el pedido como
 * facturado: `facturado_en` deja de ser NULL y el pedido sale de `shop.stock_reservado`, o sea
 * que libera su reserva. NO cambia el estado.
 *
 * UN UPDATE condicional (`WHERE id AND tenant AND estado <> 'cancelado' AND (sin factura O
 * reserva de emisión VENCIDA, ver `reservaEmisionLibre`)`), igual que `cambiarEstado`: dos
 * operadores a la vez → uno solo gana. Una reserva de "Emitir factura" que quedó colgada (la
 * función murió a mitad de camino) también se puede recuperar vinculando a mano la factura que
 * Alegra sí llegó a crear — esa es justamente la vía de recuperación que ofrece el mensaje de
 * error de la emisión. Si no afectó filas, un SELECT (también por tenant) distingue: no
 * existe/ajeno, cancelado, ya tenía ESA factura (idempotente → ok, sin tocar la fecha original ni
 * sumar un evento de más), otra factura real, o una reserva de emisión VIGENTE (conflict: hay una
 * emisión en curso, no se puede vincular por encima). El evento 'factura_vinculada' del historial
 * va en la MISMA transacción que el UPDATE.
 */
export async function vincularFactura(
  tenantId: string,
  id: string,
  input: { factura: FacturaParaVincular; actor: { id: string; name: string }; now: Date },
): Promise<FacturaResult> {
  if (!UUID_RE.test(id)) return { kind: "not_found" }
  const { factura, actor, now } = input

  const actualizado = await getDb().transaction(async (tx) => {
    const [fila] = await tx
      .update(shopOrders)
      .set({
        facturaAlegraId: factura.alegraId,
        facturaNumero: factura.numero,
        facturaFecha: factura.fecha || null,
        facturaTotal: factura.total.toFixed(2),
        facturadoEn: now,
        facturadoPor: actor.id,
        facturadoPorNombre: actor.name,
        updatedAt: now,
      })
      .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId), ne(shopOrders.estado, "cancelado"), reservaEmisionLibre()))
      .returning()
    if (!fila) return null
    await registrarEvento(tx, {
      tenantId,
      orderId: fila.id,
      tipo: "factura_vinculada",
      detalle: { numero: factura.numero },
      actor,
      now,
    })
    return fila
  })
  if (actualizado) return okConItems(tenantId, actualizado)

  const [existente] = await getDb()
    .select()
    .from(shopOrders)
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId)))
  if (!existente) return { kind: "not_found" }
  if (existente.facturaAlegraId === factura.alegraId) return okConItems(tenantId, existente)
  if (existente.facturaAlegraId) return { kind: "conflict" }
  return { kind: "cancelado" }
}

// ───────────────────────── Emisión de factura ("Emitir factura", rebanada C) ─────────────────────────
//
// A diferencia de "vincular" (donde la factura ya existe en Alegra: el operador sólo la busca y
// la lee), acá el POST del endpoint de emisión es quien LLAMA a `createInvoice` — una escritura
// real e irreversible contra Alegra. Si dos admins confirman casi al mismo tiempo, el UPDATE
// condicional de `vincularFactura` (que corre DESPUÉS de crear la factura) no alcanza para
// evitar que los dos lleguen a llamar a `createInvoice`: para eso hace falta reservar el pedido
// ANTES de tocar Alegra. `reservarEmisionFactura` hace exactamente eso, con el mismo patrón de
// UPDATE condicional atómico que el resto del archivo, usando un valor sentinela en
// `factura_alegra_id` (no hay una columna dedicada para esto todavía — no hace falta una
// migración nueva para un valor transitorio que dura lo que tarda la llamada a Alegra).
//
// Riesgo documentado (acotado, no eliminado): mientras el pedido está "reservado" (vigente o
// vencida), `facturaAlegraId` no es `null` a nivel de columna — `toPedidoDto`/`toPedidoDetalleDto`
// y las colas lo tratan explícitamente como "no facturado" (ver `estadoReservaEmision` y
// `condicionCola("sin_factura")` arriba) para que el badge, las colas y el Shop no muestren una
// factura que no existe. Si la reserva queda VENCIDA (la función que la creó murió a mitad de
// camino: timeout, crash, deploy), tanto `reservarEmisionFactura` como `vincularFactura` la tratan
// como libre (`reservaEmisionLibre`, TTL `RESERVA_EMISION_TTL_MINUTOS`) para que "Emitir" o
// "Vincular" puedan retomar el pedido sin quedar bloqueado para siempre.

export type ReservaEmisionResult = { kind: "ok" } | { kind: "not_found" } | { kind: "cancelado" } | { kind: "conflict" }

/**
 * Reserva el pedido para emitir su factura, ANTES de llamar a `createInvoice`. Mismo predicado
 * que `vincularFactura` (`WHERE ... AND estado <> 'cancelado' AND (sin factura O reserva
 * vencida)`, ver `reservaEmisionLibre`), así que sólo una de dos confirmaciones simultáneas gana
 * la reserva; la otra recibe `conflict` sin haber llegado a llamar a Alegra. Una reserva VENCIDA
 * (de una corrida anterior que murió a mitad de camino) también se puede retomar. No inserta
 * ningún evento del historial (la reserva no es un hecho de negocio; sólo lo es la emisión, si se
 * completa).
 *
 * También pone `facturado_en`/`facturado_por(_nombre)`: el CHECK `orders_factura_facturado_check`
 * (0013 del Shop) exige que un `factura_alegra_id` no nulo venga siempre con `facturado_en` no
 * nulo — el sentinel no es la excepción. `persistirFacturaEmitida` los vuelve a escribir con los
 * valores reales al confirmar; `liberarReservaEmisionFactura` los limpia junto con el sentinel si
 * la emisión no llega a completarse.
 */
export async function reservarEmisionFactura(
  tenantId: string,
  id: string,
  input: { actor: { id: string; name: string }; now: Date },
): Promise<ReservaEmisionResult> {
  if (!UUID_RE.test(id)) return { kind: "not_found" }
  const [fila] = await getDb()
    .update(shopOrders)
    .set({
      facturaAlegraId: RESERVA_EMISION_SENTINEL,
      facturadoEn: input.now,
      facturadoPor: input.actor.id,
      facturadoPorNombre: input.actor.name,
      updatedAt: input.now,
    })
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId), ne(shopOrders.estado, "cancelado"), reservaEmisionLibre()))
    .returning()
  if (fila) return { kind: "ok" }

  const [existente] = await getDb()
    .select()
    .from(shopOrders)
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId)))
  if (!existente) return { kind: "not_found" }
  if (existente.estado === "cancelado") return { kind: "cancelado" }
  return { kind: "conflict" }
}

/**
 * Libera la reserva sin dejar rastro (`createInvoice` falló: 429, error de Alegra, o cualquier
 * excepción entre la reserva y la llamada, incluida una falla al persistir después de crear la
 * factura). Sólo libera SU PROPIA reserva (`WHERE factura_alegra_id = RESERVA_EMISION_SENTINEL`):
 * si por lo que sea la fila ya no está reservada (no debería pasar: nadie más puede tocarla
 * mientras el sentinel está puesto), no hace nada.
 */
export async function liberarReservaEmisionFactura(tenantId: string, id: string): Promise<void> {
  if (!UUID_RE.test(id)) return
  await getDb()
    .update(shopOrders)
    .set({ facturaAlegraId: null, facturadoEn: null, facturadoPor: null, facturadoPorNombre: null })
    .where(
      and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId), eq(shopOrders.facturaAlegraId, RESERVA_EMISION_SENTINEL)),
    )
}

/**
 * Reemplaza la reserva por los datos reales de la factura YA creada en Alegra (`createInvoice`
 * tuvo éxito) y registra el evento `'factura_emitida'` del historial en la MISMA transacción —
 * a diferencia de `vincularFactura`, que registra `'factura_vinculada'`: son hechos de negocio
 * distintos aunque persistan las mismas columnas. El UPDATE exige `factura_alegra_id =
 * RESERVA_EMISION_SENTINEL`: si la reserva se perdió (no debería, nadie más puede tocarla), no
 * afecta filas y el resultado es `conflict` — la ruta lo trata como "se creó en Alegra pero no
 * se pudo persistir" (ver `factura/emitir/route.ts`).
 */
export async function persistirFacturaEmitida(
  tenantId: string,
  id: string,
  input: { factura: FacturaParaVincular; actor: { id: string; name: string }; now: Date },
): Promise<FacturaResult> {
  if (!UUID_RE.test(id)) return { kind: "not_found" }
  const { factura, actor, now } = input

  const actualizado = await getDb().transaction(async (tx) => {
    const [fila] = await tx
      .update(shopOrders)
      .set({
        facturaAlegraId: factura.alegraId,
        facturaNumero: factura.numero,
        facturaFecha: factura.fecha || null,
        facturaTotal: factura.total.toFixed(2),
        facturadoEn: now,
        facturadoPor: actor.id,
        facturadoPorNombre: actor.name,
        updatedAt: now,
      })
      .where(
        and(
          eq(shopOrders.id, id),
          eq(shopOrders.tenantId, tenantId),
          eq(shopOrders.facturaAlegraId, RESERVA_EMISION_SENTINEL),
        ),
      )
      .returning()
    if (!fila) return null
    await registrarEvento(tx, {
      tenantId,
      orderId: fila.id,
      tipo: "factura_emitida",
      detalle: { numero: factura.numero },
      actor,
      now,
    })
    return fila
  })
  if (actualizado) return okConItems(tenantId, actualizado)
  return { kind: "conflict" }
}

/**
 * Desvincula la factura y quita la marca de facturado (las siete columnas juntas). Si el
 * pedido sigue vivo, vuelve a reservar stock. Idempotente: sin factura → ok sin cambios (y sin
 * evento de más). `esperada` = la factura que el operador tenía en pantalla: si ahora hay otra →
 * conflict. El evento 'factura_desvinculada' guarda el número que tenía ANTES de borrarlo, y va
 * en la MISMA transacción que el UPDATE.
 */
export async function desvincularFactura(
  tenantId: string,
  id: string,
  input: { esperada: string | null; actor: { id: string; name: string }; now: Date },
): Promise<FacturaResult> {
  if (!UUID_RE.test(id)) return { kind: "not_found" }
  const conditions: SQL[] = [eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId), isNotNull(shopOrders.facturaAlegraId)]
  if (input.esperada) conditions.push(eq(shopOrders.facturaAlegraId, input.esperada))

  const actualizado = await getDb().transaction(async (tx) => {
    const [previa] = await tx.select().from(shopOrders).where(and(...conditions))
    if (!previa) return null
    const numeroPrevio = previa.facturaNumero
    const [fila] = await tx
      .update(shopOrders)
      .set({
        facturaAlegraId: null,
        facturaNumero: null,
        facturaFecha: null,
        facturaTotal: null,
        facturadoEn: null,
        facturadoPor: null,
        facturadoPorNombre: null,
        updatedAt: input.now,
      })
      .where(and(...conditions))
      .returning()
    if (!fila) return null
    await registrarEvento(tx, {
      tenantId,
      orderId: fila.id,
      tipo: "factura_desvinculada",
      detalle: { numero: numeroPrevio },
      actor: input.actor,
      now: input.now,
    })
    // La cuenta con la que se había emitido deja de valer (la elección del operador se conserva).
    await limpiarFacturaCuenta(tenantId, fila.id, tx)
    return fila
  })
  if (actualizado) return okConItems(tenantId, actualizado)

  const [existente] = await getDb()
    .select()
    .from(shopOrders)
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId)))
  if (!existente) return { kind: "not_found" }
  if (existente.facturaAlegraId) return { kind: "conflict" }
  return okConItems(tenantId, existente)
}

// ───────────────────────── Remito único por pedido (rebanada D) ─────────────────────────
//
// A diferencia de la factura, el remito vive en su PROPIA tabla (`shop.order_remitos`, 0021 del
// Shop) con una restricción de unicidad en `order_id`: un segundo intento de remitar el mismo
// pedido choca contra Postgres (23505) en vez de necesitar el mecanismo de reserva atómica con
// sentinel de "Emitir factura" (rebanada C). Alcanza acá porque el remito es un documento
// puramente informativo en Alegra (confirmado: no descuenta inventario), así que el peor caso de
// una carrera entre dos "Emitir remito" casi simultáneos es un remito huérfano en Alegra sin
// vincular localmente — sin ningún efecto de stock o dinero de por medio.

export interface RemitoParaVincular {
  alegraId: string
  numero: string | null
  /** Emisión, YYYY-MM-DD; puede venir vacío si Alegra no la trae. */
  fecha: string
}

export type RemitoResult =
  | ({ kind: "ok"; pedido: PedidoRow } & DetalleExtras)
  | { kind: "not_found" }
  | { kind: "cancelado" }
  /** El pedido ya tiene un remito (vincular/emitir) o no tiene el que el operador esperaba ver
   *  (desvincular, si se agrega esa validación en el futuro). */
  | { kind: "conflict" }

async function okConItemsRemito(tenantId: string, pedido: PedidoRow): Promise<RemitoResult> {
  const extras = await detalleExtras(tenantId, pedido)
  return { kind: "ok", pedido, ...extras }
}

/**
 * Inserta el remito del pedido (vinculado o emitido, sólo cambia el tipo de evento) dentro de
 * una transacción con su evento del historial. `not_found`/`cancelado` se chequean ANTES del
 * INSERT; el conflicto por remito duplicado sale de capturar el 23505 de Postgres (la
 * restricción de unicidad de `order_id`), no de un SELECT previo — así una carrera real entre
 * dos requests también quede resuelta por la base, no sólo por la lectura de esta función.
 */
async function insertarRemito(
  tenantId: string,
  id: string,
  input: { remito: RemitoParaVincular; actor: { id: string; name: string }; now: Date },
  tipoEvento: "remito_vinculado" | "remito_emitido",
): Promise<RemitoResult> {
  if (!UUID_RE.test(id)) return { kind: "not_found" }
  const { remito, actor, now } = input

  const [pedido] = await getDb()
    .select()
    .from(shopOrders)
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId)))
  if (!pedido) return { kind: "not_found" }
  if (pedido.estado === "cancelado") return { kind: "cancelado" }

  try {
    await getDb().transaction(async (tx) => {
      await tx.insert(shopOrderRemitos).values({
        tenantId,
        orderId: id,
        remitoAlegraId: remito.alegraId,
        remitoNumero: remito.numero,
        remitoFecha: remito.fecha || null,
        remitidoEn: now,
        remitidoPor: actor.id,
        remitidoPorNombre: actor.name,
      })
      await registrarEvento(tx, {
        tenantId,
        orderId: id,
        tipo: tipoEvento,
        detalle: { numero: remito.numero },
        actor,
        now,
      })
    })
  } catch (err) {
    if (esUniqueViolation(err)) return { kind: "conflict" }
    throw err
  }
  return okConItemsRemito(tenantId, pedido)
}

/** Camina la cadena de `cause` (drizzle/postgres-js envuelve el error crudo de Postgres ahí
 *  cuando la falla ocurre dentro de una transacción) buscando el código 23505 (unique_violation).
 *  Mismo patrón que `catalogo-overlay-repo.ts`/`cuotas-repo.ts`. */
function esUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "23505") return true
  }
  return false
}

/** "Vincular remito existente": el remito ya está emitido en Alegra (a mano, o desde otro
 *  proceso) y el operador lo asocia al pedido. */
export async function vincularRemito(
  tenantId: string,
  id: string,
  input: { remito: RemitoParaVincular; actor: { id: string; name: string }; now: Date },
): Promise<RemitoResult> {
  return insertarRemito(tenantId, id, input, "remito_vinculado")
}

/** "Emitir remito": el remito se acaba de crear en Alegra (`createRemission`, ver
 *  `lib/alegra.ts`) y se persiste el vínculo. */
export async function registrarRemitoEmitido(
  tenantId: string,
  id: string,
  input: { remito: RemitoParaVincular; actor: { id: string; name: string }; now: Date },
): Promise<RemitoResult> {
  return insertarRemito(tenantId, id, input, "remito_emitido")
}

/**
 * Suelta el remito del pedido. NO TOCA ALEGRA: el documento sigue emitido allá (mismo criterio
 * que `desvincularFactura`). Idempotente: sin remito → ok sin cambios ni evento de más. El
 * evento 'remito_desvinculado' guarda el número que tenía ANTES de borrarlo.
 */
export async function desvincularRemito(
  tenantId: string,
  id: string,
  input: { actor: { id: string; name: string }; now: Date },
): Promise<RemitoResult> {
  if (!UUID_RE.test(id)) return { kind: "not_found" }
  const [pedido] = await getDb()
    .select()
    .from(shopOrders)
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId)))
  if (!pedido) return { kind: "not_found" }

  await getDb().transaction(async (tx) => {
    const [previo] = await tx
      .delete(shopOrderRemitos)
      .where(and(eq(shopOrderRemitos.tenantId, tenantId), eq(shopOrderRemitos.orderId, id)))
      .returning()
    if (!previo) return
    await registrarEvento(tx, {
      tenantId,
      orderId: id,
      tipo: "remito_desvinculado",
      detalle: { numero: previo.remitoNumero },
      actor: input.actor,
      now: input.now,
    })
  })
  return okConItemsRemito(tenantId, pedido)
}

// ───────────────────────── Pago offline ─────────────────────────

/** Medios que cobra el comercio por fuera de la tienda: el pago lo registra un operador. */
export const PAGO_METODOS_MANUALES = ["transferencia", "efectivo", "cuenta_corriente", "a_coordinar"] as const

export function esPagoManual(row: Pick<PedidoRow, "pagoMetodo" | "pagoProveedor">): boolean {
  return (PAGO_METODOS_MANUALES as readonly string[]).includes(row.pagoMetodo) && row.pagoProveedor === null
}

export type PagoManualResult =
  | ({ kind: "ok"; pedido: PedidoRow; cambio: boolean } & DetalleExtras)
  | { kind: "not_found" }
  /** Pago online: lo mueve sólo el webhook del proveedor. */
  | { kind: "no_manual" }
  | { kind: "cancelado" }

/**
 * Registra (`pagado: true`) o anula (`pagado: false`) el pago de un pedido offline.
 *
 * UN UPDATE condicional, como `cambiarEstado`: `WHERE id AND tenant AND medio offline AND
 * pago_estado = <el opuesto>` (+ no cancelado, sólo al registrar). Si no afectó filas, un
 * SELECT (también por tenant) distingue: no existe/ajeno, online, cancelado, o ya estaba así
 * (idempotente → ok con `cambio: false`, para no avisar dos veces al cliente NI sumar un evento
 * de más). Anular se permite con el pedido cancelado: es justo el caso de un pago cargado por
 * error. El evento 'pago' del historial va en la MISMA transacción que el UPDATE.
 */
export async function registrarPagoManual(
  tenantId: string,
  id: string,
  /** `actor` sale del guard (fila fresca de admin_users), nunca del body. */
  input: { pagado: boolean; actor: { id: string; name: string }; now: Date },
): Promise<PagoManualResult> {
  if (!UUID_RE.test(id)) return { kind: "not_found" }
  const destino = input.pagado ? "pagado" : "pendiente"
  const origen = input.pagado ? "pendiente" : "pagado"

  const conditions: SQL[] = [
    eq(shopOrders.id, id),
    eq(shopOrders.tenantId, tenantId),
    inArray(shopOrders.pagoMetodo, [...PAGO_METODOS_MANUALES]),
    isNull(shopOrders.pagoProveedor),
    eq(shopOrders.pagoEstado, origen),
  ]
  if (input.pagado) conditions.push(ne(shopOrders.estado, "cancelado"))

  const actualizado = await getDb().transaction(async (tx) => {
    const [fila] = await tx
      .update(shopOrders)
      .set({
        pagoEstado: destino,
        pagoActualizadoEn: input.now,
        pagoRegistradoPor: input.actor.id,
        pagoRegistradoPorNombre: input.actor.name,
        updatedAt: input.now,
      })
      .where(and(...conditions))
      .returning()
    if (!fila) return null
    await registrarEvento(tx, {
      tenantId,
      orderId: fila.id,
      tipo: "pago",
      detalle: { estado: destino },
      actor: input.actor,
      now: input.now,
    })
    return fila
  })
  if (actualizado) {
    const extras = await detalleExtras(tenantId, actualizado)
    return { kind: "ok", pedido: actualizado, cambio: true, ...extras }
  }

  const [existente] = await getDb()
    .select()
    .from(shopOrders)
    .where(and(eq(shopOrders.id, id), eq(shopOrders.tenantId, tenantId)))
  if (!existente) return { kind: "not_found" }
  if (!esPagoManual(existente)) return { kind: "no_manual" }
  if (existente.pagoEstado === destino) {
    const extras = await detalleExtras(tenantId, existente)
    return { kind: "ok", pedido: existente, cambio: false, ...extras }
  }
  return { kind: "cancelado" }
}

/** Otros pedidos del MISMO tenant que ya tienen esa factura (aviso en la confirmación). */
export async function pedidosConFactura(tenantId: string, alegraId: string, excepto: string): Promise<string[]> {
  const filas = await getDb()
    .select({ numero: shopOrders.numero })
    .from(shopOrders)
    .where(
      and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.facturaAlegraId, alegraId), ne(shopOrders.id, excepto)),
    )
    .orderBy(asc(shopOrders.numero))
  return filas.map((f) => formatearNumeroPedido(f.numero))
}

/**
 * ¿Este pedido está reservando stock ahora? Mismo criterio que la vista `shop.stock_reservado`
 * (migración 0012 del Shop); lo fija contra la vista `stock-reservado.integration.test.ts`.
 */
const ESTADOS_QUE_RESERVAN = ["confirmado", "preparacion", "en_camino"]
export const VENTANA_PENDIENTE_MS = 24 * 60 * 60_000
export function reservaStock(row: PedidoRow, now: Date = new Date()): boolean {
  if (row.facturadoEn) return false
  if (ESTADOS_QUE_RESERVAN.includes(row.estado)) return true
  if (row.estado !== "pendiente") return false
  return row.pagoEstado === "pagado" || now.getTime() - row.createdAt.getTime() < VENTANA_PENDIENTE_MS
}

// ───────────────────────────── DTOs ─────────────────────────────

/** `numeric` de Postgres llega como string. */
const num = (v: string | null): number => (v == null ? 0 : Number(v))
/** Como `num` pero conserva el "no hay dato": `null` y un texto no numérico dan `null`, no 0. */
const numONull = (v: string | null | undefined): number | null => {
  if (v == null || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

/** Mismo formato visible que usa el Shop (`formatearNumero`): el cliente y el operador tienen
 *  que poder nombrar el pedido igual por teléfono. Se copia: las apps no comparten código. */
export function formatearNumeroPedido(numero: number): string {
  return `PED-${String(numero).padStart(8, "0")}`
}

export type PagoRevision = "cobro_duplicado" | "pagado_cancelado"

const esPagoRevision = (v: string | null): v is PagoRevision =>
  v === "cobro_duplicado" || v === "pagado_cancelado"

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
  /**
   * Por qué (lo escribe el Shop, 0010). Texto crudo: `revisionInfo` (format.ts) arma el aviso y
   * un valor desconocido o NULL (pedido anterior) cae al texto genérico.
   */
  motivoRevision: string | null
  /** Pago a revisar (lo marca el Shop): cobrado dos veces, o cobrado estando cancelado. */
  pagoRevision: PagoRevision | null
  /** Si el pedido tiene una factura de Alegra vinculada. La bandera "Sin factura" de la lista y
   *  el tablero es `estado === "entregado" && !facturado` (misma regla que la cola `sin_factura`). */
  facturado: boolean
  /** Slug de la sucursal que atiende el pedido; null = pedido anterior a las sucursales. */
  sucursal: string | null
  /**
   * Pendiente que lleva más del umbral de las reglas de venta sin marcarse "contactado". Lo agrega
   * la ruta del listado (`enriquecerConContacto`); ausente = no calculado / aviso apagado.
   */
  sinContactar?: boolean
  /** Momento en que se marcó "contactado" (ISO); ausente o null = sin contactar. */
  contactadoEn?: string | null
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
  /** Stock actual del producto según el espejo del catálogo (snapshot de la última sync o
   *  webhook, no en vivo). `null` = el producto ya no está en el espejo. */
  stockActual: number | null
  /** Slug de la sucursal de la que se TRAE esta línea (no sale de la que despacha el pedido);
   *  null = sale de la sucursal del pedido. */
  aTraerDe: string | null
  /** Costo unitario cargado en Alegra (`inventory.unitCost`). SÓLO viaja para admin y
   *  superadmin (`incluirCosto` en `toPedidoDetalleDto`): para operator la clave no existe en
   *  la respuesta. `null` = sin costo cargado en Alegra, o producto fuera del espejo. */
  costoUnitario?: number | null
}

export interface PedidoDetalleDto extends PedidoListaDto {
  /** Regla que asignó la sucursal, congelada al crear el pedido (null = anterior a las zonas). */
  sucursalRegla: ReglaAplicada | null
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
  /** Lista de precios del contacto de Alegra con ese documento; sólo con `otra_lista_precios`. */
  revisionListaPrecios: string | null
  /** Factura de Alegra vinculada (copia de cuando se vinculó), o null. Un sentinel de reserva de
   *  emisión (ver `emisionReserva`) NUNCA aparece acá: no es una factura real. */
  factura: { alegraId: string; numero: string | null; fecha: string | null; total: number | null } | null
  /** `"vigente"` = hay una emisión en curso (no ofrecer Emitir/Vincular); `"vencida"` = una
   *  emisión anterior no terminó (Emitir/Vincular siguen disponibles, con aviso); `null` = no hay
   *  ninguna reserva (sin factura, o ya con una factura real). */
  emisionReserva: "vigente" | "vencida" | null
  /** Remito único del pedido (0021 del Shop), o `null` si todavía no tiene. */
  remito: { alegraId: string; numero: string | null; fecha: string | null } | null
  facturadoEn: string | null
  facturadoPorNombre: string | null
  /** Si el pedido está apartando stock en este momento (ver `reservaStock`). */
  reservaStock: boolean
  /** Vencimiento de la reserva de un pendiente sin pago (`venceEn` null = sin vencimiento);
   *  null = el pedido no depende de un vencimiento (confirmado, pagado o facturado). */
  reserva: ReservaPedido | null
  /** Pago offline: el operador lo registra o lo anula desde el detalle. */
  pagoManual: boolean
  pagoActualizadoEn: string | null
  /** Operador que registró o anuló el último pago offline. */
  pagoRegistradoPorNombre: string | null
  items: PedidoItemDto[]
  /** Del más nuevo al más viejo; el evento 'creado' (derivado, nunca guardado) siempre es el último. */
  historial: EventoHistorialDto[]
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
    motivoRevision: row.motivoRevision,
    pagoRevision: esPagoRevision(row.pagoRevision) ? row.pagoRevision : null,
    // Un sentinel de reserva de emisión (vigente o vencida) NO es una factura real: ni el badge
    // "Facturado" del listado/tablero ni la cola `sin_factura` (ver `condicionCola` arriba) lo
    // cuentan como tal.
    facturado: !!row.facturaAlegraId && row.facturaAlegraId !== RESERVA_EMISION_SENTINEL,
    sucursal: row.sucursal,
  }
}

/** Ítem con o sin los datos del espejo: los tests y algún caller viejo arman filas peladas. */
type ItemParaDto = PedidoItemRow & Partial<Pick<PedidoItemConCatalogo, "catalogoStock" | "catalogoCosto">>

function toItemDto(item: ItemParaDto, incluirCosto: boolean): PedidoItemDto {
  const dto: PedidoItemDto = {
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
    stockActual: numONull(item.catalogoStock),
    aTraerDe: item.aTraerDe,
  }
  // La clave se AGREGA sólo con permiso (nunca `costoUnitario: undefined`): así ni siquiera el
  // nombre del campo aparece en la respuesta que ve un operador.
  if (incluirCosto) dto.costoUnitario = numONull(item.catalogoCosto)
  return dto
}

export interface DetalleDtoOpciones {
  /** Incluir el costo unitario de cada ítem. Sale de `canSeeCosts(rol)` del guard. */
  incluirCosto?: boolean
}

export function toPedidoDetalleDto(
  row: PedidoRow,
  items: ItemParaDto[],
  listaPrecios: string | null = null,
  historial: EventoHistorialDto[] = [],
  remito: RemitoRow | null = null,
  { incluirCosto = false }: DetalleDtoOpciones = {},
): PedidoDetalleDto {
  return {
    ...toPedidoDto(row),
    sucursalRegla: row.sucursalRegla ?? null,
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
    revisionListaPrecios: listaPrecios,
    factura:
      row.facturaAlegraId && row.facturaAlegraId !== RESERVA_EMISION_SENTINEL
        ? {
            alegraId: row.facturaAlegraId,
            numero: row.facturaNumero,
            fecha: row.facturaFecha,
            total: row.facturaTotal == null ? null : num(row.facturaTotal),
          }
        : null,
    emisionReserva: estadoReservaEmision(row),
    remito: remito ? { alegraId: remito.remitoAlegraId, numero: remito.remitoNumero, fecha: remito.remitoFecha } : null,
    facturadoEn: iso(row.facturadoEn),
    facturadoPorNombre: row.facturadoPorNombre,
    reservaStock: reservaStock(row),
    reserva: reservaDePendiente(row),
    pagoManual: esPagoManual(row),
    pagoActualizadoEn: iso(row.pagoActualizadoEn),
    pagoRegistradoPorNombre: row.pagoRegistradoPorNombre,
    items: items.map((i) => toItemDto(i, incluirCosto)),
    historial,
  }
}
