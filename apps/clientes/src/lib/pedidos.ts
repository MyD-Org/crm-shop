/**
 * Persistencia de pedidos. SOLO servidor.
 *
 * El pedido nace y muere en la DB del shop: Alegra no se entera hasta que un
 * operador factura a mano (decisión de fase 2, ver docs/arquitectura-integraciones.md).
 * Cuando eso cambie, el único lugar a tocar es `crearPedido`.
 */

import { cache } from "react";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orderItems, orders, pagoIntentos } from "@/db/schema";
import {
  ESTADOS_EN_CURSO,
  type EntregaTipoPedido,
  type Order,
  type OrderEstado,
  type OrderItem,
  type OrderSummary,
  type PagoEstado,
} from "@/data/orders";
import type { Product } from "@/data/products";
import { getProductosPorIds } from "./catalog";
import { vaciarCarritoTx } from "./carrito-db";
import type { Cotizacion } from "./cotizacion";
import type { MotivoRevisionPedido } from "./motivo-revision";
import type { PlanPedido } from "./pagos/cuotas-tipos";
import {
  ENTREGA_LABEL,
  PAGO_LABEL,
  type EntregaTipo,
  type PagoMetodo,
} from "./envio";
import { shopTenantId } from "./tenant";

/** Formato visible del número correlativo. */
export function formatearNumero(numero: number): string {
  return `PED-${String(numero).padStart(8, "0")}`;
}

/** `numeric` de Postgres vuelve como string: convertir siempre por acá. */
const num = (v: string | null) => (v == null ? 0 : Number(v));

/**
 * Quién compra. `clerkUserId` es el ancla y siempre está; `codigo` (contacto de
 * Alegra) falta cuando el comprador no vinculó cuenta corriente.
 */
export interface DatosCliente {
  clerkUserId: string | null;
  codigo?: string;
  razonSocial?: string;
  cuit?: string;
  email?: string;
  idPriceList?: string;
}

export interface DatosPedido {
  contactoNombre: string;
  contactoTelefono: string;
  entregaTipo: EntregaTipo;
  entregaCiudad?: string;
  entregaDireccion?: string;
  pagoMetodo: PagoMetodo;
  notas?: string;
  /** Copia congelada del perfil de facturación al momento de comprar. */
  facturacion?: {
    tipoDoc: string;
    nroDoc: string;
    razonSocial: string;
    condicionIva: string;
    domicilio?: string;
  };
  /** Un operador tiene que revisar el pedido antes de facturar. */
  requiereRevision?: boolean;
  /** Por qué (el más importante; ver `motivo-revision.ts`). */
  motivoRevision?: MotivoRevisionPedido | null;
  /**
   * Clave del intento de compra, generada por el checkout. Reintentar el mismo
   * intento devuelve el pedido que ya existe en vez de crear otro.
   */
  idempotencyKey?: string;
}

/**
 * Escribe el pedido y sus líneas en una transacción.
 *
 * Solo se persisten las líneas SIN problema. La validación de que no haya
 * problemas ocurre antes, en la API: si algo llegó roto hasta acá, es preferible
 * un pedido corto que uno con una línea de total 0 que nadie va a poder cobrar.
 *
 * Es IDEMPOTENTE cuando viene `idempotencyKey`: el segundo intento con la misma
 * clave devuelve el pedido original con `repetido: true`, sin escribir nada (ni
 * siquiera vacía el carrito del servidor). La decisión la toma Postgres con un
 * índice único parcial, no un `select` previo — dos requests simultáneos
 * pasarían los dos por ese select.
 *
 * Un pedido nuevo de un usuario de Clerk vacía su carrito del servidor
 * (`shop.carts`) dentro de la misma transacción. Los ítems del pedido salen de
 * `cotizacion` (el body del request), nunca de ese carrito.
 */
export async function crearPedido(
  cliente: DatosCliente,
  datos: DatosPedido,
  cotizacion: Cotizacion,
  /**
   * Plan de cuotas resuelto por el server sobre `cotizacion.total`. null = sin
   * oferta leíble o medio offline → cuotas_max null (legacy 1..24).
   */
  plan: PlanPedido | null = null,
): Promise<{ id: string; numero: string; repetido: boolean; cuotasMax: number | null }> {
  const lineas = cotizacion.lineas.filter((l) => !l.problema);
  if (lineas.length === 0) {
    throw new Error("No hay líneas válidas para crear el pedido");
  }

  return getDb().transaction(async (tx) => {
    const [pedido] = await tx
      .insert(orders)
      .values({
        // El tenant sale SIEMPRE del entorno, nunca de `datos` ni del request:
        // la base es compartida con el CRM y este valor decide qué operadores
        // ven el pedido. Los campos se copian uno por uno a propósito: nada que
        // venga de más en `datos` llega a la fila.
        tenantId: shopTenantId(),
        idempotencyKey: datos.idempotencyKey ?? null,
        clerkUserId: cliente.clerkUserId,
        clienteCodigo: cliente.codigo ?? null,
        clienteRazonSocial: cliente.razonSocial ?? null,
        clienteCuit: cliente.cuit ?? null,
        clienteEmail: cliente.email ?? null,
        idPriceList: cliente.idPriceList ?? null,
        contactoNombre: datos.contactoNombre,
        contactoTelefono: datos.contactoTelefono,
        entregaTipo: datos.entregaTipo,
        entregaCiudad: datos.entregaCiudad ?? null,
        entregaDireccion: datos.entregaDireccion ?? null,
        pagoMetodo: datos.pagoMetodo,
        notas: datos.notas ?? null,
        facturacionTipoDoc: datos.facturacion?.tipoDoc ?? null,
        facturacionNroDoc: datos.facturacion?.nroDoc ?? null,
        facturacionRazonSocial: datos.facturacion?.razonSocial ?? null,
        facturacionCondicionIva: datos.facturacion?.condicionIva ?? null,
        facturacionDomicilio: datos.facturacion?.domicilio ?? null,
        requiereRevision: datos.requiereRevision ?? false,
        motivoRevision: datos.motivoRevision ?? null,
        subtotal: String(cotizacion.subtotal),
        iva: String(cotizacion.iva),
        costoEnvio: String(cotizacion.costoEnvio),
        total: String(cotizacion.total),
        cuotasMax: plan?.cuotasMax ?? null,
        cuotasPlan: plan,
      })
      // El `where` acá es el predicado del índice parcial, no un filtro de
      // filas: sin él, Postgres no sabe qué índice usar para resolver el
      // conflicto y rechaza el ON CONFLICT.
      .onConflictDoNothing({
        target: orders.idempotencyKey,
        where: sql`${orders.idempotencyKey} is not null`,
      })
      .returning({ id: orders.id, numero: orders.numero, cuotasMax: orders.cuotasMax });

    // Sin fila devuelta, la clave ya existía: es un reintento del mismo intento
    // de compra. Se devuelve el pedido original y NO se escriben las líneas de
    // nuevo — duplicarlas dejaría el pedido con el doble de todo.
    if (!pedido) {
      const [existente] = await tx
        .select({ id: orders.id, numero: orders.numero, cuotasMax: orders.cuotasMax })
        .from(orders)
        .where(
          and(
            eq(orders.idempotencyKey, datos.idempotencyKey!),
            eq(orders.tenantId, shopTenantId()),
          ),
        )
        .limit(1);

      if (!existente) {
        // El insert chocó pero la fila no aparece: solo puede pasar si algo
        // ajeno la borró en el medio. Preferible fallar que devolver un pedido
        // inventado.
        throw new Error("Conflicto de idempotencia sin pedido asociado");
      }

      return {
        id: existente.id,
        numero: formatearNumero(existente.numero),
        repetido: true,
        cuotasMax: existente.cuotasMax,
      };
    }

    await tx.insert(orderItems).values(
      lineas.map((l) => ({
        orderId: pedido.id,
        alegraItemId: l.id,
        code: l.code,
        name: l.name,
        brand: l.brand || null,
        qty: String(l.qty),
        precioUnitario: String(l.precioUnitario),
        ivaPorcentaje: String(l.ivaPorcentaje),
        subtotal: String(l.subtotal),
        iva: String(l.iva),
        total: String(l.total),
      })),
    );

    // El carrito del servidor se vacía en la MISMA transacción: si el pedido no
    // se crea, el carrito queda como estaba. Sólo en esta rama (pedido nuevo):
    // el reintento idempotente de arriba ya volvió sin tocarlo, así que no vacía
    // un carrito que el usuario haya llenado después. Sin Clerk (cookie del
    // CRM) no hay carrito del servidor.
    if (cliente.clerkUserId) await vaciarCarritoTx(tx, cliente.clerkUserId);

    return {
      id: pedido.id,
      numero: formatearNumero(pedido.numero),
      repetido: false,
      cuotasMax: pedido.cuotasMax,
    };
  });
}

/**
 * Busca un pedido ya creado con esta clave de intento.
 *
 * Es un atajo, no la garantía: sirve para cortar el reintento ANTES de volver a
 * cotizar contra Alegra (que son hasta 60 llamadas para descubrir algo que ya
 * sabíamos). Quien garantiza que no haya duplicados es el índice único de
 * `crearPedido`, porque dos requests simultáneos pasarían los dos por acá.
 *
 * Se filtra por dueño: la clave la elige el cliente, así que sin este filtro
 * alguien podría adivinar una clave ajena y leer el número de pedido de otro.
 */
export async function getPedidoPorClave(
  idempotencyKey: string,
  dueno: DuenoPedidos,
): Promise<{ id: string; numero: string; cuotasMax: number | null } | null> {
  const [fila] = await getDb()
    .select({ id: orders.id, numero: orders.numero, cuotasMax: orders.cuotasMax })
    .from(orders)
    .where(and(eq(orders.idempotencyKey, idempotencyKey), esDeSuDueno(dueno)))
    .limit(1);

  return fila
    ? { id: fila.id, numero: formatearNumero(fila.numero), cuotasMax: fila.cuotasMax }
    : null;
}

/** Fila cruda de `orders` + sus líneas, armada como `Order` de UI. */
export type FilaOrder = typeof orders.$inferSelect;
export type FilaItem = typeof orderItems.$inferSelect;

/**
 * Arma el `Order` de UI. `productos` es el espejo del catálogo para los ítems
 * de las líneas (ver `productosDeLineas`): de ahí salen el nombre real, el
 * código y la foto. Un ítem que ya no está en el espejo cae al snapshot de la
 * línea.
 *
 * @internal Exportada para testearla sin base; el resto del código consume
 * `listarPedidos` / `getPedido`.
 */
export function armarOrder(
  fila: FilaOrder,
  items: FilaItem[],
  productos: ReadonlyMap<string, Product> = new Map(),
): Order {
  return {
    id: fila.id,
    numero: formatearNumero(fila.numero),
    fecha: fila.createdAt.toISOString(),
    estado: fila.estado as OrderEstado,
    pagoEstado: fila.pagoEstado as PagoEstado,
    metodoPago: PAGO_LABEL[fila.pagoMetodo as PagoMetodo] ?? fila.pagoMetodo,
    metodoEntrega:
      ENTREGA_LABEL[fila.entregaTipo as EntregaTipo] ?? fila.entregaTipo,
    entregaTipo: fila.entregaTipo as EntregaTipoPedido,
    entregaCiudad: fila.entregaCiudad ?? undefined,
    entregaDireccion: fila.entregaDireccion ?? undefined,
    subtotal: num(fila.subtotal),
    iva: num(fila.iva),
    costoEnvio: num(fila.costoEnvio),
    total: num(fila.total),
    items: items.map((i): OrderItem => {
      const producto = productos.get(i.alegraItemId);
      const imagen = producto?.images?.[0];
      return {
        id: i.alegraItemId,
        name: i.name,
        brand: i.brand ?? "",
        code: i.code,
        qty: num(i.qty),
        price: num(i.precioUnitario),
        total: num(i.total),
        nombreVisible: producto?.name || i.name,
        codigo: i.code || producto?.sku || i.name,
        ...(imagen ? { imagen } : {}),
      };
    }),
  };
}

/**
 * Espejo del catálogo para las líneas: UNA consulta con los ids sin repetir,
 * sin filtro de estado ni de visibilidad (un pedido viejo sigue mostrando el
 * nombre de un ítem despublicado). Sin líneas no consulta.
 */
function productosDeLineas(items: FilaItem[]): Promise<Map<string, Product>> {
  return getProductosPorIds([...new Set(items.map((i) => i.alegraItemId))]);
}

/**
 * A quién le pertenecen los pedidos que se están pidiendo.
 *
 * Son dos llaves porque hay dos historias que unificar: lo que compró esta
 * cuenta de acceso, y lo que compró esta cuenta corriente (posiblemente desde
 * el portal viejo del CRM, antes de que existiera Clerk).
 */
export interface DuenoPedidos {
  clerkUserId: string | null;
  clienteCodigo?: string;
}

/**
 * El pedido es de este Shop. `orders` vive en la base del CRM, que es
 * multi-tenant: toda consulta que no pase por `esDeSuDueno` tiene que llevar
 * esto a mano (cobros, webhook, reconciliación).
 */
function esDeEsteTenant() {
  return eq(orders.tenantId, shopTenantId());
}

/**
 * Condición de pertenencia: del tenant de este Shop Y de quien lo pide.
 *
 * El tenant va acá adentro y no en cada consulta para que sea imposible
 * olvidarlo: todo lo que el comprador lee o toca (Mis compras, detalle,
 * resumen, idempotencia, rescate, pago, cancelar) pasa por esta función.
 *
 * Devuelve `false` literal si no hay ninguna llave de dueño: sin esto, un dueño
 * vacío se traduciría en un WHERE sin dueño y la consulta devolvería los
 * pedidos de TODOS los clientes.
 */
function esDeSuDueno(dueno: DuenoPedidos) {
  const condiciones = [];
  if (dueno.clerkUserId) {
    condiciones.push(eq(orders.clerkUserId, dueno.clerkUserId));
  }
  if (dueno.clienteCodigo) {
    condiciones.push(eq(orders.clienteCodigo, dueno.clienteCodigo));
  }
  const deSuDueno = condiciones.length === 0 ? sql`false` : or(...condiciones);
  return and(esDeEsteTenant(), deSuDueno);
}

/**
 * Pedidos de un cliente, del más nuevo al más viejo.
 *
 * Dos queries y un agrupado en memoria en vez de un join: con el join, un pedido
 * de 40 líneas se repite 40 veces en el resultado y hay que deduplicar igual.
 * Una tercera trae el nombre real y la foto de todos los ítems juntos.
 */
export async function listarPedidos(
  dueno: DuenoPedidos,
  limite = 50,
): Promise<Order[]> {
  const db = getDb();

  const filas = await db
    .select()
    .from(orders)
    .where(esDeSuDueno(dueno))
    .orderBy(desc(orders.createdAt))
    .limit(limite);

  if (filas.length === 0) return [];

  const items = await db
    .select()
    .from(orderItems)
    .where(
      inArray(
        orderItems.orderId,
        filas.map((f) => f.id),
      ),
    );

  const porPedido = new Map<string, FilaItem[]>();
  for (const item of items) {
    const lista = porPedido.get(item.orderId);
    if (lista) lista.push(item);
    else porPedido.set(item.orderId, [item]);
  }

  const productos = await productosDeLineas(items);
  return filas.map((f) => armarOrder(f, porPedido.get(f.id) ?? [], productos));
}

/**
 * `cache()` memoiza por identidad de cada argumento: por eso la versión
 * cacheada recibe las llaves del dueño como primitivos y no el objeto (dos
 * `{ clerkUserId, clienteCodigo }` iguales armados en lugares distintos no
 * compartirían resultado).
 */
const getPedidoCacheado = cache(async function getPedidoCacheado(
  id: string,
  clerkUserId: string | null,
  clienteCodigo: string | undefined,
): Promise<Order | null> {
  const db = getDb();
  const [fila] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), esDeSuDueno({ clerkUserId, clienteCodigo })))
    .limit(1);

  if (!fila) return null;

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, fila.id));

  return armarOrder(fila, items, await productosDeLineas(items));
});

/**
 * Un pedido puntual, solo si pertenece a quien lo pide. Memoizado por request
 * (`cache()`): la página del detalle y el breadcrumb lo comparten.
 */
export function getPedido(id: string, dueno: DuenoPedidos): Promise<Order | null> {
  return getPedidoCacheado(id, dueno.clerkUserId, dueno.clienteCodigo);
}

// --- Pago online -----------------------------------------------------------

/** Lo mínimo que necesita la ruta de pago, ya validado contra el dueño. */
export interface PedidoParaPago {
  id: string;
  numero: string;
  total: number;
  pagoEstado: PagoEstado;
  pagoMetodo: string;
  clienteEmail: string | null;
  facturacionTipoDoc: string | null;
  facturacionNroDoc: string | null;
  /** Congelado al crear el pedido. null = legacy / sin oferta leíble. */
  cuotasMax: number | null;
  /** Estado del pedido (no del pago): sólo se cobra uno `pendiente`. */
  estado: OrderEstado;
  creadoEn: Date;
}

/**
 * Cuánto tiempo después de creado se puede cobrar un pedido online. Es la misma
 * ventana en la que el checkout lo retoma (`pedidoPendienteMasReciente`): pasado
 * eso el comprador lo ve en "Mis pedidos" para pagarlo por otra vía, y cobrarlo
 * igual sería cobrar un total congelado hace días.
 */
export const VENTANA_PAGO_MS = 24 * 60 * 60_000;

/**
 * Por qué NO se puede cobrar un pedido, o null si se puede.
 *
 * Sin esto se podía pagar un pedido cancelado (por el cliente o por un
 * operador), o uno de hace semanas con precios viejos: la ruta solo miraba
 * dueño, método y "ya pagado".
 */
export function motivoNoCobrable(
  pedido: Pick<PedidoParaPago, "estado" | "creadoEn">,
  ahora = Date.now(),
): "cancelado" | "en_curso" | "vencido" | null {
  if (pedido.estado === "cancelado") return "cancelado";
  // Confirmado, en preparación, etc.: un operador ya lo está manejando y el
  // pago se coordina con él.
  if (pedido.estado !== "pendiente") return "en_curso";
  if (ahora - pedido.creadoEn.getTime() > VENTANA_PAGO_MS) return "vencido";
  return null;
}

/**
 * Trae un pedido para cobrarlo, SOLO si es de quien lo pide.
 *
 * El total sale de acá y de ningún otro lado: es el número congelado en la
 * transacción que creó el pedido. Que el monto no venga del browser es la
 * regla que sostiene todo lo demás (§2 de docs/pagos-mercadopago.md).
 */
export async function getPedidoParaPago(
  id: string,
  dueno: DuenoPedidos,
): Promise<PedidoParaPago | null> {
  const [fila] = await getDb()
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), esDeSuDueno(dueno)))
    .limit(1);

  if (!fila) return null;

  return {
    id: fila.id,
    numero: formatearNumero(fila.numero),
    total: num(fila.total),
    pagoEstado: fila.pagoEstado as PagoEstado,
    pagoMetodo: fila.pagoMetodo,
    clienteEmail: fila.clienteEmail,
    facturacionTipoDoc: fila.facturacionTipoDoc,
    facturacionNroDoc: fila.facturacionNroDoc,
    cuotasMax: fila.cuotasMax,
    estado: fila.estado as OrderEstado,
    creadoEn: fila.createdAt,
  };
}

/** Lo que se persiste de un intento de cobro, venga de la ruta o del webhook. */
export interface ResultadoCobro {
  proveedor: string;
  referencia: string;
  estado: PagoEstado;
  detalle: string;
  medio?: string;
  /** true si el proveedor informó un contracargo o una devolución. */
  reversion?: boolean;
  /** Cuotas reales del cobro, si el proveedor las informó. */
  cuotas?: number;
  /** Total pagado con interés, si el proveedor lo informó. */
  totalPagado?: number;
}

/**
 * Columnas de cuotas reales a escribir. Sólo las que vinieron y son válidas:
 * un evento sin esos datos no pisa lo que ya se guardó. `orders.total` NO se
 * toca nunca: es lo que se cotizó; el interés vive en `pago_total_pagado`.
 */
export function camposCuotasCobro(
  cobro: ResultadoCobro,
): { pagoCuotas?: number; pagoTotalPagado?: string } {
  const campos: { pagoCuotas?: number; pagoTotalPagado?: string } = {};
  if (Number.isInteger(cobro.cuotas) && (cobro.cuotas as number) >= 1) campos.pagoCuotas = cobro.cuotas;
  if (typeof cobro.totalPagado === "number" && Number.isFinite(cobro.totalPagado) && cobro.totalPagado >= 0) {
    campos.pagoTotalPagado = cobro.totalPagado.toFixed(2);
  }
  return campos;
}

/**
 * ¿Se permite pasar de `actual` a `nuevo`?
 *
 * Las notificaciones llegan desordenadas y repetidas. Sin estas reglas, un
 * evento viejo puede desmarcar un pago bueno y dejar un pedido cobrado como
 * pendiente — que es peor que no procesarlo, porque nadie se entera.
 *
 * - De `pagado` NO se baja, salvo contracargo o devolución: ahí la plata
 *   efectivamente se fue y el pedido tiene que reflejarlo.
 * - De `fallido` sí se sube: un reintento exitoso es legítimo.
 */
export function transicionPermitida(
  actual: PagoEstado,
  nuevo: PagoEstado,
  reversion = false,
): boolean {
  if (actual === nuevo) return false;
  if (actual === "pagado") return reversion && nuevo === "fallido";
  return true;
}

/** Filtro de tenant para `pago_intentos`, igual que `esDeEsteTenant` para `orders`. */
function intentoDeEsteTenant() {
  return eq(pagoIntentos.tenantId, shopTenantId());
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

interface FilaIntento {
  id: string;
  referencia: string | null;
  estado: PagoEstado;
}

const columnasIntento = {
  id: pagoIntentos.id,
  referencia: pagoIntentos.referencia,
  estado: pagoIntentos.estado,
};

/**
 * La fila de `pago_intentos` que corresponde a este cobro. En orden:
 *
 * 1. La que ya tiene esta referencia (evento repetido, o el webhook que llegó
 *    antes que la respuesta de la ruta). Si además la ruta traía una reserva
 *    propia, esa reserva sobra y se borra: el pago ya quedó anotado.
 * 2. La reserva abierta del pedido (sin referencia todavía): la de la ruta, o
 *    la que dejó un timeout y ahora reclama el webhook.
 * 3. Si no hay ninguna, una fila nueva: un pago que el webhook recuperó por
 *    `external_reference` y que la base no conocía.
 */
async function intentoDelCobro(
  tx: Tx,
  pedidoId: string,
  cobro: ResultadoCobro,
  intentoId?: string,
): Promise<FilaIntento & { nuevo: boolean }> {
  if (cobro.referencia) {
    const [porReferencia] = await tx
      .select(columnasIntento)
      .from(pagoIntentos)
      .where(
        and(
          eq(pagoIntentos.proveedor, cobro.proveedor),
          eq(pagoIntentos.referencia, cobro.referencia),
          intentoDeEsteTenant(),
        ),
      )
      .limit(1);
    if (porReferencia) {
      if (intentoId && intentoId !== porReferencia.id) {
        await tx
          .delete(pagoIntentos)
          .where(and(eq(pagoIntentos.id, intentoId), isNull(pagoIntentos.referencia), intentoDeEsteTenant()));
      }
      return { ...porReferencia, estado: porReferencia.estado as PagoEstado, nuevo: false };
    }
  }

  const [reserva] = await tx
    .select(columnasIntento)
    .from(pagoIntentos)
    .where(
      and(
        eq(pagoIntentos.orderId, pedidoId),
        intentoId ? eq(pagoIntentos.id, intentoId) : undefined,
        isNull(pagoIntentos.referencia),
        eq(pagoIntentos.estado, "pendiente"),
        intentoDeEsteTenant(),
      ),
    )
    .limit(1);
  if (reserva) return { ...reserva, estado: reserva.estado as PagoEstado, nuevo: false };

  const [creada] = await tx
    .insert(pagoIntentos)
    .values({
      tenantId: shopTenantId(),
      orderId: pedidoId,
      proveedor: cobro.proveedor,
      referencia: cobro.referencia || null,
      estado: "pendiente",
    })
    .returning(columnasIntento);
  return { ...creada, estado: creada.estado as PagoEstado, nuevo: true };
}

/**
 * Estado del pago del PEDIDO a partir de todos sus intentos.
 *
 * - Con un intento cobrado, el pedido está pagado: la plata entró, aunque haya
 *   otros rechazados o abiertos.
 * - Sin cobrados, alcanza un intento abierto para que siga pendiente.
 * - Si todos se cayeron, fallido.
 */
export function estadoDelPedido(estados: PagoEstado[]): PagoEstado | null {
  if (estados.length === 0) return null;
  if (estados.includes("pagado")) return "pagado";
  if (estados.includes("pendiente")) return "pendiente";
  return "fallido";
}

/** Motivo por el que un operador tiene que revisar el pago. Ver `orders.pago_revision`. */
export type PagoRevision = "cobro_duplicado" | "pagado_cancelado";

/**
 * ¿Hay que revisar este pago? Se recalcula en cada evento, así que una
 * devolución procesada en el proveedor limpia la marca sola.
 */
export function revisionDelPago(
  cobrados: number,
  estadoPago: PagoEstado,
  estadoPedido: OrderEstado,
): PagoRevision | null {
  if (cobrados > 1) return "cobro_duplicado";
  if (estadoPago === "pagado" && estadoPedido === "cancelado") return "pagado_cancelado";
  return null;
}

/**
 * Guarda el resultado de un cobro: primero en su intento, después el resumen
 * en el pedido.
 *
 * Idempotente por dos vías: el índice único sobre `(proveedor, referencia)` de
 * `pago_intentos`, y el chequeo de transición por intento. Reprocesar el mismo
 * evento no cambia nada.
 *
 * `intentoId` es la reserva que abrió la ruta de cobro (`reservarIntento`); el
 * webhook y la reconciliación no la pasan.
 *
 * Devuelve `true` si algo cambió, para poder distinguir en los logs un evento
 * nuevo de un reintento de Mercado Pago.
 */
export async function registrarCobro(
  pedidoId: string,
  cobro: ResultadoCobro,
  opciones: { intentoId?: string } = {},
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    /**
     * `for update` no es decorativo: sin el lock, dos notificaciones que llegan
     * juntas leen las dos el mismo estado viejo y la última en escribir gana.
     *
     * El caso que rompe: llega la acreditación y el contracargo casi a la vez.
     * Las dos leen `pendiente`, las dos consideran válida su transición, y el
     * pedido puede terminar en `pagado` cuando la plata ya se fue. Con el lock,
     * la segunda espera, lee `pagado`, y aplica la reversión como corresponde.
     * El lock es sobre el PEDIDO, así que también serializa intentos distintos.
     */
    const [fila] = await tx
      .select({ estado: orders.pagoEstado, pedidoEstado: orders.estado })
      .from(orders)
      .where(and(eq(orders.id, pedidoId), esDeEsteTenant()))
      .limit(1)
      .for("update");

    if (!fila) return false;

    const intento = await intentoDelCobro(tx, pedidoId, cobro, opciones.intentoId);
    // Las reglas de transición (eventos desordenados, reversiones) se aplican
    // por intento: cada pago tiene su propia historia en el proveedor.
    const cambiaIntento = transicionPermitida(intento.estado, cobro.estado, cobro.reversion);
    const cuotas = camposCuotasCobro(cobro);

    // El detalle se guarda SIEMPRE, aunque el estado no cambie: es lo que
    // permite reconciliar y diagnosticar después.
    await tx
      .update(pagoIntentos)
      .set({
        referencia: cobro.referencia || null,
        detalle: cobro.detalle,
        ...(cobro.medio ? { medio: cobro.medio } : {}),
        ...(cuotas.pagoCuotas !== undefined ? { cuotas: cuotas.pagoCuotas } : {}),
        ...(cuotas.pagoTotalPagado !== undefined ? { totalPagado: cuotas.pagoTotalPagado } : {}),
        ...(cambiaIntento ? { estado: cobro.estado } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(pagoIntentos.id, intento.id), intentoDeEsteTenant()));

    const intentos = await tx
      .select({
        ...columnasIntento,
        proveedor: pagoIntentos.proveedor,
        detalle: pagoIntentos.detalle,
        medio: pagoIntentos.medio,
        cuotas: pagoIntentos.cuotas,
        totalPagado: pagoIntentos.totalPagado,
      })
      .from(pagoIntentos)
      .where(and(eq(pagoIntentos.orderId, pedidoId), intentoDeEsteTenant()))
      .orderBy(asc(pagoIntentos.createdAt));

    const actual = fila.estado as PagoEstado;
    const nuevo = estadoDelPedido(intentos.map((i) => i.estado as PagoEstado)) ?? actual;

    const cobrados = intentos.filter((i) => i.estado === "pagado");
    const revision = revisionDelPago(cobrados.length, nuevo, fila.pedidoEstado as OrderEstado);
    if (revision) {
      // No debería pasar (la ruta no abre un intento con otro abierto, y la
      // cancelación no corre con un pago en curso), así que si pasa tiene que
      // hacer ruido además de quedar marcado para el CRM.
      console.error(
        `[pagos] ${revision} pedido=${pedidoId} referencias=${cobrados.map((i) => i.referencia).join(",")}`,
      );
    }

    // El resumen del pedido refleja el intento que decide su estado: el cobrado
    // si lo hay; si no, este mismo cuando coincide, o el último que coincida.
    const coinciden = intentos.filter((i) => i.estado === nuevo);
    const decisivo =
      cobrados[0] ??
      coinciden.find((i) => i.id === intento.id) ??
      coinciden[coinciden.length - 1];

    await tx
      .update(orders)
      .set({
        ...(decisivo
          ? {
              pagoProveedor: decisivo.proveedor,
              pagoReferencia: decisivo.referencia,
              pagoDetalle: decisivo.detalle,
              ...(decisivo.medio ? { pagoMedio: decisivo.medio } : {}),
              ...(decisivo.cuotas != null ? { pagoCuotas: decisivo.cuotas } : {}),
              ...(decisivo.totalPagado != null ? { pagoTotalPagado: decisivo.totalPagado } : {}),
            }
          : {}),
        ...(nuevo !== actual ? { pagoEstado: nuevo } : {}),
        pagoRevision: revision,
        pagoActualizadoEn: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, pedidoId), esDeEsteTenant()));

    return intento.nuevo || cambiaIntento || nuevo !== actual;
  });
}

/** Intento abierto de un pedido: reservado (sin referencia) o pendiente en el proveedor. */
export interface IntentoAbierto {
  id: string;
  proveedor: string;
  referencia: string | null;
  creadoEn: Date;
}

/**
 * Abre un intento de cobro, SOLO si el pedido no tiene otro abierto.
 *
 * Con dos pagos abiertos a la vez los dos se pueden aprobar, y el comprador
 * paga dos veces. El lock sobre la fila del pedido hace que dos requests
 * simultáneos no puedan pasar los dos el chequeo: el segundo espera y ve la
 * reserva del primero.
 */
export async function reservarIntento(
  pedidoId: string,
  proveedor: string,
  medio: string,
): Promise<{ intentoId: string } | { abierto: IntentoAbierto } | { noCobrable: true } | null> {
  return getDb().transaction(async (tx) => {
    const [pedido] = await tx
      .select({ id: orders.id, estado: orders.estado })
      .from(orders)
      .where(and(eq(orders.id, pedidoId), esDeEsteTenant()))
      .limit(1)
      .for("update");
    if (!pedido) return null;
    // Se vuelve a mirar el estado CON el lock: la ruta lo chequeó antes, pero
    // el comprador (o un operador) pudo cancelarlo entre medio.
    if (pedido.estado !== "pendiente") return { noCobrable: true };

    const [abierto] = await tx
      .select({
        id: pagoIntentos.id,
        proveedor: pagoIntentos.proveedor,
        referencia: pagoIntentos.referencia,
        creadoEn: pagoIntentos.createdAt,
      })
      .from(pagoIntentos)
      .where(
        and(
          eq(pagoIntentos.orderId, pedidoId),
          eq(pagoIntentos.estado, "pendiente"),
          intentoDeEsteTenant(),
        ),
      )
      .orderBy(asc(pagoIntentos.createdAt))
      .limit(1);
    if (abierto) return { abierto };

    const [creado] = await tx
      .insert(pagoIntentos)
      .values({ tenantId: shopTenantId(), orderId: pedidoId, proveedor, medio })
      .returning({ id: pagoIntentos.id });
    return { intentoId: creado.id };
  });
}

/**
 * Deja constancia de un intento de cobro que NUNCA llegó a crear un pago.
 *
 * Pasa cuando el proveedor rechaza la llamada: credenciales mal, red caída, un
 * 400 por un campo. Sin esto el pedido queda en `pendiente` sin rastro alguno, y
 * ni un operador ni nosotros podemos saber que hubo un intento ni por qué falló
 * — que es exactamente lo que pasó la primera vez que se probó de verdad.
 *
 * NO toca `pago_estado` del pedido: que la llamada fallara no significa que el
 * pago se haya rechazado. Puede no haber existido nunca. Marcarlo `fallido`
 * sería afirmar algo que no sabemos.
 *
 * Con `intentoId`, además cierra esa reserva (si todavía no tiene referencia)
 * para que no bloquee el próximo intento.
 */
export async function registrarIntentoFallido(
  pedidoId: string,
  motivo: string,
  intentoId?: string,
): Promise<void> {
  const detalle = `error_proveedor: ${motivo}`.slice(0, 300);
  if (intentoId) await descartarReserva(intentoId, detalle);
  await getDb()
    .update(orders)
    .set({
      pagoDetalle: detalle,
      pagoActualizadoEn: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, pedidoId), esDeEsteTenant()));
}

/**
 * Cierra una reserva que nunca obtuvo referencia del proveedor. Si ya la tiene
 * (el webhook la reclamó mientras tanto), no la toca: ahí hay un pago real.
 */
export async function descartarReserva(intentoId: string, detalle: string): Promise<void> {
  await getDb()
    .update(pagoIntentos)
    .set({ estado: "fallido", detalle: detalle.slice(0, 300), updatedAt: new Date() })
    .where(
      and(
        eq(pagoIntentos.id, intentoId),
        isNull(pagoIntentos.referencia),
        eq(pagoIntentos.estado, "pendiente"),
        intentoDeEsteTenant(),
      ),
    );
}

/**
 * Pedido pendiente de pago más reciente del comprador.
 *
 * Existe porque el carrito NO se vacía al confirmar el pedido (se vacía recién
 * al pagar), y sin este chequeo un comprador que reintenta el checkout crearía
 * un pedido-fantasma nuevo cada vez. Al montar el checkout, se busca acá; si
 * hay algo se salta directo al brick con ese pedido en vez de crear otro.
 *
 * La ventana de 24h es pragmática: un pedido pendiente más viejo que eso
 * probablemente el comprador ya se olvidó, y forzarlo a resumirlo lo confunde
 * más que ayuda. Los sigue viendo en "Mis pedidos" para pagar por otra vía.
 */
export async function pedidoPendienteMasReciente(
  dueno: DuenoPedidos,
): Promise<{ id: string; numero: string; total: number; cuotasMax: number | null } | null> {
  const desde = new Date(Date.now() - VENTANA_PAGO_MS);
  const [fila] = await getDb()
    .select({ id: orders.id, numero: orders.numero, total: orders.total, cuotasMax: orders.cuotasMax })
    .from(orders)
    .where(
      and(
        esDeSuDueno(dueno),
        eq(orders.pagoEstado, "pendiente"),
        eq(orders.estado, "pendiente"),
        eq(orders.pagoMetodo, "mercadopago"),
        gte(orders.createdAt, desde),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);

  if (!fila) return null;
  return {
    id: fila.id,
    numero: formatearNumero(fila.numero),
    total: num(fila.total),
    cuotasMax: fila.cuotasMax,
  };
}

/**
 * Motivo que queda cuando cancela el propio comprador. `cancelacion_motivo` es
 * un dato INTERNO (se ve en el admin, nunca en el Shop) y la base exige que todo
 * pedido cancelado tenga uno, lo cancele quien lo cancele.
 */
const MOTIVO_CANCELADO_POR_CLIENTE = "Cancelado por el cliente.";

/**
 * Cancela un pedido pendiente. Es lo que dispara el botón "armar otro" en el
 * checkout cuando el comprador quiere modificar el carrito en vez de pagar el
 * pedido que dejó a medias.
 *
 * Requisitos:
 *  - Es del dueño y de este tenant (sin este filtro, alguien adivinando ids
 *    podría cancelar pedidos ajenos).
 *  - Sigue en `estado = 'pendiente'`: una vez que un operador lo confirmó, el
 *    pedido ya no es del comprador para cancelar. Antes solo se miraba
 *    `pago_estado`, y con los pagos apagados TODOS los pedidos quedan con el pago
 *    pendiente para siempre: un comprador podía cancelar por API un pedido
 *    confirmado, en camino o entregado, a espaldas de quien lo estaba preparando.
 *  - Sigue en `pago_estado = 'pendiente'` — cancelar un pagado sería una
 *    devolución, y eso pasa por otro flujo.
 *
 * Deja la misma auditoría que un cambio de estado hecho desde el admin, sin
 * usuario (`estado_actualizado_por` es un id de `admin_users` y acá no hay
 * ninguno): quién fue se lee en `estado_actualizado_por_nombre`.
 *
 *  - No tiene un intento de cobro abierto (`pago_en_curso`).
 *
 * Devuelve `"cancelado"` solo si efectivamente cambió algo. Quien llama no
 * distingue el porqué del `null` a propósito: "no existe", "no es suyo" y "ya no
 * se puede cancelar" contestan el mismo 404.
 */
export async function cancelarPedidoPendiente(
  id: string,
  dueno: DuenoPedidos,
): Promise<"cancelado" | "pago_en_curso" | null> {
  return getDb().transaction(async (tx) => {
    // Mismo lock que `reservarIntento`: un intento de cobro y la cancelación
    // del mismo pedido no pueden correr a la vez.
    const [pedido] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.id, id),
          esDeSuDueno(dueno),
          eq(orders.estado, "pendiente"),
          eq(orders.pagoEstado, "pendiente"),
        ),
      )
      .limit(1)
      .for("update");
    if (!pedido) return null;

    /**
     * Con un pago abierto no se cancela: si después se aprueba, queda un pedido
     * cancelado y cobrado. Quien llama tiene que cerrar ese intento antes
     * (`resolverIntentoAbierto`).
     */
    const [abierto] = await tx
      .select({ id: pagoIntentos.id })
      .from(pagoIntentos)
      .where(
        and(
          eq(pagoIntentos.orderId, id),
          eq(pagoIntentos.estado, "pendiente"),
          intentoDeEsteTenant(),
        ),
      )
      .limit(1);
    if (abierto) return "pago_en_curso";

    const ahora = new Date();
    await tx
      .update(orders)
      .set({
        estado: "cancelado",
        cancelacionMotivo: MOTIVO_CANCELADO_POR_CLIENTE,
        estadoActualizadoEn: ahora,
        estadoActualizadoPor: null,
        estadoActualizadoPorNombre: "Cliente",
        updatedAt: ahora,
      })
      .where(and(eq(orders.id, id), esDeEsteTenant()));
    return "cancelado";
  });
}

/**
 * Intento abierto de un pedido propio, para cerrarlo antes de cancelar. Filtra
 * por dueño: la ruta de cancelación no lee el pedido por otro lado.
 */
export async function intentoAbiertoDelPedido(
  id: string,
  dueno: DuenoPedidos,
): Promise<IntentoAbierto | null> {
  const [fila] = await getDb()
    .select({
      id: pagoIntentos.id,
      proveedor: pagoIntentos.proveedor,
      referencia: pagoIntentos.referencia,
      creadoEn: pagoIntentos.createdAt,
    })
    .from(pagoIntentos)
    .innerJoin(orders, eq(orders.id, pagoIntentos.orderId))
    .where(
      and(
        eq(pagoIntentos.orderId, id),
        eq(pagoIntentos.estado, "pendiente"),
        intentoDeEsteTenant(),
        esDeSuDueno(dueno),
      ),
    )
    .orderBy(asc(pagoIntentos.createdAt))
    .limit(1);
  return fila ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Encuentra el pedido al que pertenece un pago del proveedor.
 *
 * Es lo que usan el webhook y la reconciliación: la notificación trae el id del
 * pago, no el del pedido. Se busca en este orden:
 *
 * 1. `pago_intentos`, donde queda cada intento (no solo el último).
 * 2. `orders.pago_referencia`, por un pedido anterior a la tabla de intentos
 *    que se le haya escapado al backfill.
 * 3. `pedidoIdExterno`: el `external_reference` que el propio proveedor dice
 *    que tiene el pago. Rescata un intento que la base nunca llegó a anotar
 *    (timeout al crearlo) o que se pisó antes de existir la tabla. Solo pedidos
 *    de este tenant y cobrados por este proveedor.
 */
export async function pedidoDelPago(
  proveedor: string,
  referencia: string,
  pedidoIdExterno?: string,
): Promise<{ id: string; pagoEstado: PagoEstado } | null> {
  const db = getDb();
  const columnas = { id: orders.id, estado: orders.pagoEstado };
  const armar = (f: { id: string; estado: string } | undefined) =>
    f ? { id: f.id, pagoEstado: f.estado as PagoEstado } : null;

  const [porIntento] = await db
    .select(columnas)
    .from(pagoIntentos)
    .innerJoin(orders, eq(orders.id, pagoIntentos.orderId))
    .where(
      and(
        eq(pagoIntentos.proveedor, proveedor),
        eq(pagoIntentos.referencia, referencia),
        intentoDeEsteTenant(),
        esDeEsteTenant(),
      ),
    )
    .limit(1);
  if (porIntento) return armar(porIntento);

  const [porPedido] = await db
    .select(columnas)
    .from(orders)
    .where(and(eq(orders.pagoReferencia, referencia), esDeEsteTenant()))
    .limit(1);
  if (porPedido) return armar(porPedido);

  if (!pedidoIdExterno || !UUID.test(pedidoIdExterno)) return null;
  const [porExterno] = await db
    .select(columnas)
    .from(orders)
    .where(
      and(
        eq(orders.id, pedidoIdExterno),
        eq(orders.pagoMetodo, proveedor),
        esDeEsteTenant(),
      ),
    )
    .limit(1);
  return armar(porExterno);
}

/**
 * Intentos con referencia que siguen abiertos, para que la reconciliación le
 * pregunte al proveedor cómo terminaron. Ver `lib/pagos/reconciliar.ts`.
 */
export async function intentosPendientesDeReconciliar(opciones: {
  proveedor: string;
  /** Sin tocar desde antes de esto (el webhook podría estar por llegar). */
  quietosDesde: Date;
  /** Creados después de esto. */
  creadosDesde: Date;
  limite: number;
}): Promise<{ orderId: string; referencia: string }[]> {
  const filas = await getDb()
    .select({ orderId: pagoIntentos.orderId, referencia: pagoIntentos.referencia })
    .from(pagoIntentos)
    .where(
      and(
        // La base es compartida con el CRM y acá no hay comprador que acote la
        // consulta: sin esto, el cron de un Shop reconciliaría pedidos de otro.
        intentoDeEsteTenant(),
        eq(pagoIntentos.estado, "pendiente"),
        eq(pagoIntentos.proveedor, opciones.proveedor),
        sql`${pagoIntentos.referencia} is not null`,
        lt(pagoIntentos.updatedAt, opciones.quietosDesde),
        gte(pagoIntentos.createdAt, opciones.creadosDesde),
      ),
    )
    .orderBy(asc(pagoIntentos.createdAt))
    .limit(opciones.limite);
  return filas.filter((f): f is { orderId: string; referencia: string } => f.referencia != null);
}

/**
 * Resumen para Mi cuenta. Se calcula en Postgres, no trayendo los pedidos a
 * memoria: es una tarjeta de tres números, no una lista.
 *
 * "Del año" limita sólo los dos agregados anuales. Los pedidos EN CURSO se
 * cuentan sin importar la fecha: un pedido en camino del 28/12 sigue en curso
 * el 3/1. Por eso el año va dentro de cada `filter` y no en el `where`.
 *
 * Los cancelados no suman al total comprado.
 */
export async function resumenPedidos(
  dueno: DuenoPedidos,
): Promise<OrderSummary> {
  const inicioAnio = new Date(new Date().getFullYear(), 0, 1);
  const delAnio = gte(orders.createdAt, inicioAnio);

  const [fila] = await getDb()
    .select({
      pedidos: sql<number>`count(*) filter (where ${delAnio})::int`,
      enCurso: sql<number>`count(*) filter (where ${inArray(orders.estado, ESTADOS_EN_CURSO)})::int`,
      comprado: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.estado} <> 'cancelado' and ${delAnio}), 0)::float8`,
    })
    .from(orders)
    .where(esDeSuDueno(dueno));

  return {
    pedidosEsteAnio: fila?.pedidos ?? 0,
    enCurso: fila?.enCurso ?? 0,
    compradoEsteAnio: fila?.comprado ?? 0,
  };
}
