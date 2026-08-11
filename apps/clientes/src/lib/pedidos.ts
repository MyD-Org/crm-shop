/**
 * Persistencia de pedidos. SOLO servidor.
 *
 * El pedido nace y muere en la DB del shop: Alegra no se entera hasta que un
 * operador factura a mano (decisión de fase 2, ver docs/arquitectura-integraciones.md).
 * Cuando eso cambie, el único lugar a tocar es `crearPedido`.
 */

import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orderItems, orders } from "@/db/schema";
import {
  ESTADOS_EN_CURSO,
  type Order,
  type OrderEstado,
  type OrderItem,
  type OrderSummary,
  type PagoEstado,
} from "@/data/orders";
import type { Cotizacion } from "./cotizacion";
import {
  ENTREGA_LABEL,
  PAGO_LABEL,
  type EntregaTipo,
  type PagoMetodo,
} from "./envio";

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
  /** El documento coincide con un contacto de Alegra sin vincular. */
  requiereRevision?: boolean;
}

/**
 * Escribe el pedido y sus líneas en una transacción.
 *
 * Solo se persisten las líneas SIN problema. La validación de que no haya
 * problemas ocurre antes, en la API: si algo llegó roto hasta acá, es preferible
 * un pedido corto que uno con una línea de total 0 que nadie va a poder cobrar.
 */
export async function crearPedido(
  cliente: DatosCliente,
  datos: DatosPedido,
  cotizacion: Cotizacion,
): Promise<{ id: string; numero: string }> {
  const lineas = cotizacion.lineas.filter((l) => !l.problema);
  if (lineas.length === 0) {
    throw new Error("No hay líneas válidas para crear el pedido");
  }

  return getDb().transaction(async (tx) => {
    const [pedido] = await tx
      .insert(orders)
      .values({
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
        subtotal: String(cotizacion.subtotal),
        iva: String(cotizacion.iva),
        costoEnvio: String(cotizacion.costoEnvio),
        total: String(cotizacion.total),
      })
      .returning({ id: orders.id, numero: orders.numero });

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

    return { id: pedido.id, numero: formatearNumero(pedido.numero) };
  });
}

/** Fila cruda de `orders` + sus líneas, armada como `Order` de UI. */
type FilaOrder = typeof orders.$inferSelect;
type FilaItem = typeof orderItems.$inferSelect;

function armarOrder(fila: FilaOrder, items: FilaItem[]): Order {
  return {
    id: fila.id,
    numero: formatearNumero(fila.numero),
    fecha: fila.createdAt.toISOString(),
    estado: fila.estado as OrderEstado,
    pagoEstado: fila.pagoEstado as PagoEstado,
    metodoPago: PAGO_LABEL[fila.pagoMetodo as PagoMetodo] ?? fila.pagoMetodo,
    metodoEntrega:
      ENTREGA_LABEL[fila.entregaTipo as EntregaTipo] ?? fila.entregaTipo,
    entregaCiudad: fila.entregaCiudad ?? undefined,
    entregaDireccion: fila.entregaDireccion ?? undefined,
    subtotal: num(fila.subtotal),
    iva: num(fila.iva),
    costoEnvio: num(fila.costoEnvio),
    total: num(fila.total),
    items: items.map(
      (i): OrderItem => ({
        id: i.alegraItemId,
        name: i.name,
        brand: i.brand ?? "",
        code: i.code,
        qty: num(i.qty),
        price: num(i.precioUnitario),
        total: num(i.total),
      }),
    ),
  };
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
 * Condición de pertenencia. Devuelve `false` literal si no hay ninguna llave:
 * sin esto, un dueño vacío se traduciría en un WHERE vacío y la consulta
 * devolvería los pedidos de TODOS los clientes.
 */
function esDeSuDueno(dueno: DuenoPedidos) {
  const condiciones = [];
  if (dueno.clerkUserId) {
    condiciones.push(eq(orders.clerkUserId, dueno.clerkUserId));
  }
  if (dueno.clienteCodigo) {
    condiciones.push(eq(orders.clienteCodigo, dueno.clienteCodigo));
  }
  if (condiciones.length === 0) return sql`false`;
  return or(...condiciones);
}

/**
 * Pedidos de un cliente, del más nuevo al más viejo.
 *
 * Dos queries y un agrupado en memoria en vez de un join: con el join, un pedido
 * de 40 líneas se repite 40 veces en el resultado y hay que deduplicar igual.
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

  return filas.map((f) => armarOrder(f, porPedido.get(f.id) ?? []));
}

/** Un pedido puntual, solo si pertenece a quien lo pide. */
export async function getPedido(
  id: string,
  dueno: DuenoPedidos,
): Promise<Order | null> {
  const db = getDb();
  const [fila] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), esDeSuDueno(dueno)))
    .limit(1);

  if (!fila) return null;

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, fila.id));

  return armarOrder(fila, items);
}

/**
 * Resumen del año para Mi cuenta. Se calcula en Postgres, no trayendo los
 * pedidos a memoria: es una tarjeta de tres números, no una lista.
 *
 * Los cancelados no suman al total comprado.
 */
export async function resumenPedidos(
  dueno: DuenoPedidos,
): Promise<OrderSummary> {
  const inicioAnio = new Date(new Date().getFullYear(), 0, 1);

  const [fila] = await getDb()
    .select({
      pedidos: sql<number>`count(*)::int`,
      enCurso: sql<number>`count(*) filter (where ${inArray(orders.estado, ESTADOS_EN_CURSO)})::int`,
      comprado: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.estado} <> 'cancelado'), 0)::float8`,
    })
    .from(orders)
    .where(and(esDeSuDueno(dueno), gte(orders.createdAt, inicioAnio)));

  return {
    pedidosEsteAnio: fila?.pedidos ?? 0,
    enCurso: fila?.enCurso ?? 0,
    compradoEsteAnio: fila?.comprado ?? 0,
  };
}
