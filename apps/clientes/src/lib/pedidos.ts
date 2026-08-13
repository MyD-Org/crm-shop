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
 * clave devuelve el pedido original con `repetido: true`, sin escribir nada. La
 * decisión la toma Postgres con un índice único parcial, no un `select` previo
 * — dos requests simultáneos pasarían los dos por ese select.
 */
export async function crearPedido(
  cliente: DatosCliente,
  datos: DatosPedido,
  cotizacion: Cotizacion,
): Promise<{ id: string; numero: string; repetido: boolean }> {
  const lineas = cotizacion.lineas.filter((l) => !l.problema);
  if (lineas.length === 0) {
    throw new Error("No hay líneas válidas para crear el pedido");
  }

  return getDb().transaction(async (tx) => {
    const [pedido] = await tx
      .insert(orders)
      .values({
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
        subtotal: String(cotizacion.subtotal),
        iva: String(cotizacion.iva),
        costoEnvio: String(cotizacion.costoEnvio),
        total: String(cotizacion.total),
      })
      // El `where` acá es el predicado del índice parcial, no un filtro de
      // filas: sin él, Postgres no sabe qué índice usar para resolver el
      // conflicto y rechaza el ON CONFLICT.
      .onConflictDoNothing({
        target: orders.idempotencyKey,
        where: sql`${orders.idempotencyKey} is not null`,
      })
      .returning({ id: orders.id, numero: orders.numero });

    // Sin fila devuelta, la clave ya existía: es un reintento del mismo intento
    // de compra. Se devuelve el pedido original y NO se escriben las líneas de
    // nuevo — duplicarlas dejaría el pedido con el doble de todo.
    if (!pedido) {
      const [existente] = await tx
        .select({ id: orders.id, numero: orders.numero })
        .from(orders)
        .where(eq(orders.idempotencyKey, datos.idempotencyKey!))
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

    return {
      id: pedido.id,
      numero: formatearNumero(pedido.numero),
      repetido: false,
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
): Promise<{ id: string; numero: string } | null> {
  const [fila] = await getDb()
    .select({ id: orders.id, numero: orders.numero })
    .from(orders)
    .where(and(eq(orders.idempotencyKey, idempotencyKey), esDeSuDueno(dueno)))
    .limit(1);

  return fila ? { id: fila.id, numero: formatearNumero(fila.numero) } : null;
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

/**
 * Guarda el resultado de un cobro sobre el pedido.
 *
 * Idempotente por dos vías: el índice único parcial sobre `pago_referencia`, y
 * el chequeo de transición. Reprocesar el mismo evento no cambia nada.
 *
 * Devuelve `true` si algo cambió, para poder distinguir en los logs un evento
 * nuevo de un reintento de Mercado Pago.
 */
export async function registrarCobro(
  pedidoId: string,
  cobro: ResultadoCobro,
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
     */
    const [fila] = await tx
      .select({ estado: orders.pagoEstado })
      .from(orders)
      .where(eq(orders.id, pedidoId))
      .limit(1)
      .for("update");

    if (!fila) return false;

    const actual = fila.estado as PagoEstado;
    // La referencia y el detalle se guardan SIEMPRE, aunque el estado no
    // cambie: son lo que permite reconciliar y diagnosticar después.
    await tx
      .update(orders)
      .set({
        pagoProveedor: cobro.proveedor,
        pagoReferencia: cobro.referencia,
        pagoDetalle: cobro.detalle,
        ...(cobro.medio ? { pagoMedio: cobro.medio } : {}),
        ...(transicionPermitida(actual, cobro.estado, cobro.reversion)
          ? { pagoEstado: cobro.estado }
          : {}),
        pagoActualizadoEn: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, pedidoId));

    return transicionPermitida(actual, cobro.estado, cobro.reversion);
  });
}

/**
 * Encuentra el pedido al que pertenece una referencia del proveedor.
 *
 * Es lo que usa el webhook: la notificación trae el id del pago, no el del
 * pedido.
 */
export async function pedidoPorReferencia(
  referencia: string,
): Promise<{ id: string; pagoEstado: PagoEstado } | null> {
  const [fila] = await getDb()
    .select({ id: orders.id, estado: orders.pagoEstado })
    .from(orders)
    .where(eq(orders.pagoReferencia, referencia))
    .limit(1);

  return fila ? { id: fila.id, pagoEstado: fila.estado as PagoEstado } : null;
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
