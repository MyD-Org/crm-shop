/**
 * Envío de los mails al comprador sobre su pedido (ver `pedido-mail.ts`). SOLO servidor.
 *
 * Se llaman DESPUÉS de que el pedido o el cobro quedaron guardados y NUNCA lanzan: un mail que
 * no sale no puede tumbar un pedido ni hacer que Mercado Pago reintente un webhook. El
 * resultado sólo se loguea, sin datos del comprador.
 *
 * No importa `pedidos.ts` (que es quien llama a `avisarCobro`): lee el pedido por su cuenta.
 */
import { cuponParaResumen } from "./cupones/ui";
import { and, asc, eq, gt, inArray, isNull, lt, ne, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crmSucursales, crmTenants } from "@/db/crm";
import { orderItems, orders, pagoIntentos } from "@/db/schema";
import { datosTenant } from "./cuenta-corriente/tenant-cc";
import { enviarEmail } from "./email";
import { etiquetaEntrega } from "./envio";
import { contactoDeSucursal } from "./contacto-pedido-repo";
import { esMedioCuentaCorriente, esPagoEnLinea, nombreDelPago, slugsPagoEnLinea } from "./medios-pago";
import { leerMediosPagoTolerante } from "./medios-pago-repo";
import { urlSitioMail } from "./mail-layout";
import {
  armarMailPedido,
  armarMailPedidoOperador,
  destinoAvisoOperador,
  transferenciaParaMail,
  type AvisoPedidoShop,
  type LineaMail,
} from "./pedido-mail";
import { reservaVenceMsSql, tokenLinkPago } from "./pedido-link-pago";
import { shopTenantId } from "./tenant";
import { sitioParaMailDelPedido } from "./sitio-origen";
import { urlLogoMarca } from "./vinculacion-mail";
import { getMarca } from "./marca";
import { leerSnapshot, pedidoAConfirmarPorModalidad } from "./venta-sin-stock";

const RUTA_PEDIDOS = "/mi-cuenta/pedidos";
const RUTA_CHECKOUT = "/checkout";

function looksLikeEmail(s: string | null): s is string {
  return typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

function urlPedidos(sitio = process.env.NEXT_PUBLIC_SITE_URL, ruta = RUTA_PEDIDOS): string | null {
  if (!sitio) return null;
  try {
    return new URL(ruta, sitio).toString();
  } catch {
    return null;
  }
}

/**
 * Qué avisar tras registrar un cobro en línea. Sólo el cambio del estado de pago DEL PEDIDO
 * (no de cada intento): así un reintento de Mercado Pago o un segundo intento rechazado no
 * repiten el mail. Una reversión (contracargo, devolución) no se avisa por acá.
 */
export function avisoDelCobro(antes: string, despues: string, reversion: boolean): AvisoPedidoShop | null {
  if (antes === despues || reversion) return null;
  if (despues === "pagado") return "pago_recibido";
  if (despues === "fallido") return "pago_rechazado";
  return null;
}

/**
 * Línea del mail. Una línea a pedido lleva el texto de su modalidad, leído del snapshot del pedido
 * (sigue aunque la modalidad se haya borrado); un jsonb roto o viejo, sin texto.
 */
function lineaParaMail(l: { nombre: string; cantidad: string; ventaSinStock?: unknown }): LineaMail {
  const aPedido = leerSnapshot(l.ventaSinStock)?.texto;
  return { nombre: l.nombre, cantidad: Number(l.cantidad), ...(aPedido ? { aPedido } : {}) };
}

/** Pedido de invitado SIN cuenta: ya reclamado (`clerk_user_id`) o con cliente vinculado, es de una cuenta. */
export function esPedidoDeInvitado(p: {
  compraInvitado: boolean;
  clerkUserId: string | null;
  clienteCodigo: string | null;
}): boolean {
  return p.compraInvitado && !p.clerkUserId && !p.clienteCodigo;
}

/** `/registro?email=`: el email del propio destinatario, en SU mail (la ruta no tiene tracking). */
function urlCrearCuenta(sitio: string | undefined, email: string): string | null {
  return urlPedidos(sitio, `/registro?email=${encodeURIComponent(email)}`);
}

/**
 * «Pagar su pedido»: sólo si el pedido sigue pendiente de pago en línea (los mails de transferencia ya
 * traen los datos para transferir y no tienen a dónde "pagar" en la web) y nunca en "pago_recibido".
 * Sin `PEDIDO_LINK_SECRET` no hay link: el mail sale sin botón.
 */
async function linkPagarSuPedido(
  pedido: { id: string; createdAt: Date; estado: string; pagoEstado: string; pagoMetodo: string },
  aviso: AvisoPedidoShop,
  sitio: string | undefined,
): Promise<string | null> {
  if (aviso === "pago_recibido") return null;
  if (pedido.estado !== "pendiente" || (pedido.pagoEstado !== "pendiente" && pedido.pagoEstado !== "fallido")) return null;
  if (!esPagoEnLinea(pedido.pagoMetodo)) return null;
  let reservaVenceEn: number | null = null;
  try {
    const [r] = await getDb()
      .select({ ms: reservaVenceMsSql })
      .from(orders)
      .where(and(eq(orders.id, pedido.id), eq(orders.tenantId, shopTenantId())))
      .limit(1);
    reservaVenceEn = r?.ms === null || r?.ms === undefined ? null : Number(r.ms);
  } catch (err) {
    console.error(`[avisos pedido] ${pedido.id}: no se pudo leer la reserva para el link de pago:`, err);
  }
  const token = tokenLinkPago({
    orderId: pedido.id,
    creadoEn: pedido.createdAt.getTime(),
    reservaVenceEn,
    enLinea: true,
  });
  return token ? urlPedidos(sitio, `/pagar/${token}`) : null;
}

async function enviarAviso(
  pedidoId: string,
  aviso: AvisoPedidoShop,
  clave: string,
): Promise<void> {
  try {
    const [pedido] = await getDb()
      .select()
      .from(orders)
      .where(and(eq(orders.id, pedidoId), eq(orders.tenantId, shopTenantId())))
      .limit(1);
    if (!pedido) return;
    const to = pedido.clienteEmail?.trim() ?? null;
    if (!looksLikeEmail(to)) {
      console.warn(`[avisos pedido] ${pedidoId} ${aviso}: el pedido no tiene email`);
      return;
    }

    let comercio = "";
    try {
      comercio = (await datosTenant())?.nombre ?? "";
    } catch (err) {
      console.error("[avisos pedido] no se pudieron leer los datos del tenant:", err);
    }

    // Con cobro en línea el "recibido" no existe: su confirmación es "pago_recibido".
    if (aviso === "recibido" && esPagoEnLinea(pedido.pagoMetodo)) return;

    // "recibido" y "pago_recibido" confirman el pedido (medio con su nombre, plazo y WhatsApp);
    // "pago_pendiente" muestra el resumen y el nombre del medio, pero no el plazo de contacto.
    const confirma = aviso === "recibido" || aviso === "pago_recibido";
    const conResumen = aviso !== "pago_rechazado";
    const lineas =
      conResumen
        ? await getDb()
            .select({ nombre: orderItems.name, cantidad: orderItems.qty, ventaSinStock: orderItems.ventaSinStock })
            .from(orderItems)
            .where(eq(orderItems.orderId, pedidoId))
            .orderBy(asc(orderItems.id))
        : [];

    // En los mails que confirman el pedido ("recibido" y "pago_recibido"): el pago con el nombre
    // del medio del CRM y el plazo + WhatsApp de la sucursal. Lecturas que no tiran.
    const numero = `PED-${String(pedido.numero).padStart(8, "0")}`;
    const recibido = aviso === "recibido";
    const medios = conResumen ? await leerMediosPagoTolerante() : null;
    const contacto = confirma ? await contactoDeSucursal(pedido.sucursal, numero) : null;

    // Links al sitio donde se hizo el pedido (o al del entorno si es anterior a 0044).
    const sitio = sitioParaMailDelPedido(pedido.sitioOrigen);
    // Compra como invitado: sin cuenta no hay «Ver mis pedidos»; el mail lleva «Pagar su pedido»
    // (mientras siga pendiente de pago en línea) y «Cree su cuenta». Ya reclamado = como cualquier cuenta.
    const invitado = esPedidoDeInvitado(pedido);
    const pagarUrl = invitado ? await linkPagarSuPedido(pedido, aviso, sitio) : null;
    const mail = armarMailPedido({
      aviso,
      numero,
      contactoNombre: pedido.contactoNombre,
      comercio: comercio || "Su pedido",
      logoUrl: urlLogoMarca(await getMarca(), sitio),
      pedidosUrl: invitado ? null : urlPedidos(sitio),
      checkoutUrl:
        aviso !== "pago_rechazado"
          ? null
          : invitado
            ? pagarUrl
            : urlPedidos(sitio, `${RUTA_CHECKOUT}?pedido=${encodeURIComponent(pedidoId)}`),
      ...(invitado ? { pagarUrl, cuentaUrl: urlCrearCuenta(sitio, to) } : {}),
      sitioUrl: urlSitioMail(sitio),
      lineas: lineas.map(lineaParaMail),
      total: Number(pedido.total),
      ...(Number(pedido.costoEnvio) > 0 ? { costoEnvio: Number(pedido.costoEnvio) } : {}),
      cupon: cuponParaResumen(pedido.cupon),
      entrega: etiquetaEntrega(pedido.entregaTipo, pedido.entregaCiudad, pedido.entregaDireccion),
      pago: nombreDelPago(pedido.pagoMetodo, medios),
      // Venta sin stock: pedido a confirmar por modalidad (sale con "a_coordinar"; no se cobró nada).
      ...(recibido &&
      pedidoAConfirmarPorModalidad(
        pedido.pagoMetodo,
        lineas.map((l) => ({ ventaSinStock: leerSnapshot(l.ventaSinStock) })),
      )
        ? { aConfirmar: true }
        : {}),
      // Lo que cobró el procesador (cuotas y total pagado): va junto al medio.
      ...(aviso === "pago_recibido" && pedido.pagoCuotas && pedido.pagoTotalPagado
        ? { pagado: { total: Number(pedido.pagoTotalPagado), cuotas: pedido.pagoCuotas } }
        : {}),
      // Cuenta corriente: el medio del pedido es el de audiencia `cuenta_corriente` (por el campo,
      // nunca por el nombre ni el slug).
      pagoCuentaCorriente: Boolean(medios?.some((m) => m.slug === pedido.pagoMetodo && esMedioCuentaCorriente(m))),
      // Transferencia: la cuenta congelada en el pedido (nunca se vuelve a resolver).
      ...(recibido && transferenciaParaMail(pedido.pagoMetodo, pedido.pagoCuenta)
        ? { transferencia: transferenciaParaMail(pedido.pagoMetodo, pedido.pagoCuenta) }
        : {}),
      ...(contacto
        ? { contacto: { mensaje: contacto.mensaje } }
        : {}),
    });

    const r = await enviarEmail({
      to,
      ...mail,
      tags: [{ name: "tipo", value: `pedido_${aviso}` }],
      idempotencyKey: clave,
    });
    if (r.ok) console.log(`[avisos pedido] ${pedidoId} ${aviso}: enviado`);
    else if (!r.noConfigurado) console.error(`[avisos pedido] ${pedidoId} ${aviso}: ${r.error}`);
  } catch (err) {
    console.error(`[avisos pedido] ${pedidoId} ${aviso}: no se pudo enviar`, err);
  }
}

/**
 * "Recibimos su pedido", al crearlo. Quien llama descarta los pedidos repetidos. Con cobro en
 * línea no sale (no hace nada): el comprador recibe un solo mail al aprobarse el pago.
 */
export function avisarPedidoRecibido(pedidoId: string, medioNuevo?: string): Promise<void> {
  // Con `medioNuevo` (el comprador dejó la transferencia por otro medio sin cobro en línea) va otro
  // "recibido" con los datos del medio nuevo: la clave distinta evita que se descarte por repetido.
  const clave = medioNuevo ? `pedido/${pedidoId}/recibido/${medioNuevo}` : `pedido/${pedidoId}/recibido`;
  return enviarAviso(pedidoId, "recibido", clave);
}

/** Aviso del cobro en línea, si corresponde (ver `avisoDelCobro`). */
export async function avisarCobro(
  pedidoId: string,
  cambio: { antes: string; despues: string; reversion: boolean; referencia: string },
): Promise<void> {
  const aviso = avisoDelCobro(cambio.antes, cambio.despues, cambio.reversion);
  if (!aviso) return;
  // "pago_recibido" sin referencia en la clave: un solo mail de confirmación por pedido, aunque
  // lo aprueben dos caminos (respuesta directa, consulta, conciliación, webhook) con otra referencia.
  const clave =
    aviso === "pago_recibido"
      ? `pedido/${pedidoId}/pago_recibido`
      : `pedido/${pedidoId}/${aviso}/${cambio.referencia || "sin-ref"}`;
  await enviarAviso(pedidoId, aviso, clave);
  // El pedido con pago en línea recién le llega al local cuando se aprueba el pago
  // (ver `avisoOperadorAlCrear`). La clave del mail evita duplicarlo.
  if (aviso === "pago_recibido") await avisarOperadorPedidoNuevo(pedidoId);
}

/** Con transferencia, cuánto se espera como máximo para avisar si el comprador no se fue de la pantalla. */
export const ESPERA_AVISOS_MS = 15 * 60_000;

/**
 * Los avisos de un pedido sin cobro en línea ("Recibimos su pedido" y "Nuevo pedido"), UNA sola vez y
 * con el medio que tenga el pedido en este momento. Se queda con el pedido marcando
 * `avisos_enviados_en` en la misma sentencia (si dos caminos llegan juntos —irse de la pantalla y el
 * cron—, sólo uno manda) y recién después envía. Nunca lanza. Devuelve si le tocó avisar.
 */
export async function avisarPedidoSiFalta(pedidoId: string): Promise<boolean> {
  try {
    const [marcado] = await getDb()
      .update(orders)
      .set({ avisosEnviadosEn: new Date() })
      .where(
        and(
          eq(orders.id, pedidoId),
          eq(orders.tenantId, shopTenantId()),
          isNull(orders.avisosEnviadosEn),
          ne(orders.estado, "cancelado"),
          notInArray(orders.pagoMetodo, slugsPagoEnLinea()),
        ),
      )
      .returning({ id: orders.id });
    if (!marcado) return false;
    await avisarPedidoRecibido(pedidoId);
    await avisarOperadorPedidoNuevo(pedidoId);
    return true;
  } catch (err) {
    console.error(`[avisos pedido] ${pedidoId}: no se pudo avisar`, err);
    return false;
  }
}

/** Pedidos sin cobro en línea que esperan sus avisos hace más de `ESPERA_AVISOS_MS` (para el cron). */
export async function pedidosConAvisosPendientes(ahora = new Date()): Promise<string[]> {
  const filas = await getDb()
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, shopTenantId()),
        isNull(orders.avisosEnviadosEn),
        ne(orders.estado, "cancelado"),
        notInArray(orders.pagoMetodo, slugsPagoEnLinea()),
        lt(orders.createdAt, new Date(ahora.getTime() - ESPERA_AVISOS_MS)),
      ),
    )
    .orderBy(asc(orders.createdAt))
    .limit(50);
  return filas.map((f) => f.id);
}

// --- Aviso «pendiente de pago» del invitado (a los 30 minutos, una sola vez) -------------------------

/** Cuánto espera un pedido de invitado con pago en línea sin pagar antes del aviso único. */
export const ESPERA_AVISO_PAGO_PENDIENTE_MS = 30 * 60_000;
/** Pasada la ventana de cobro del pedido ya no se avisa (el link no serviría). */
const LIMITE_AVISO_PAGO_PENDIENTE_MS = 24 * 60 * 60_000;

/**
 * Pedidos de invitado con medio en línea, sin pagar, creados hace entre 30 min y 24 h, sin aviso previo
 * y sin un cobro ya enviado al procesador y sin resolver (a ese comprador no se le dice «pague»).
 */
function condicionesAvisoPagoPendiente(ahora: Date) {
  const lineas = slugsPagoEnLinea();
  return and(
    eq(orders.tenantId, shopTenantId()),
    eq(orders.compraInvitado, true),
    isNull(orders.clerkUserId),
    isNull(orders.clienteCodigo),
    isNull(orders.avisoPagoPendienteEn),
    eq(orders.estado, "pendiente"),
    eq(orders.pagoEstado, "pendiente"),
    isNull(orders.pagoRevision),
    enMediosEnLinea(lineas),
    lt(orders.createdAt, new Date(ahora.getTime() - ESPERA_AVISO_PAGO_PENDIENTE_MS)),
    gt(orders.createdAt, new Date(ahora.getTime() - LIMITE_AVISO_PAGO_PENDIENTE_MS)),
    sql`not exists (select 1 from ${pagoIntentos} where ${pagoIntentos.orderId} = ${orders.id} and ${pagoIntentos.estado} = 'pendiente' and ${pagoIntentos.referencia} is not null)`,
  );
}

/** Sin medios en línea configurados no hay nada que avisar: `inArray` con lista vacía no es SQL válido. */
function enMediosEnLinea(slugs: readonly string[]) {
  return slugs.length > 0 ? inArray(orders.pagoMetodo, [...slugs]) : sql`false`;
}

/** Ids de los pedidos que esperan el aviso «pendiente de pago» (para el cron). */
export async function pedidosConAvisoPagoPendiente(ahora = new Date()): Promise<string[]> {
  const filas = await getDb()
    .select({ id: orders.id })
    .from(orders)
    .where(condicionesAvisoPagoPendiente(ahora))
    .orderBy(asc(orders.createdAt))
    .limit(50);
  return filas.map((f) => f.id);
}

/**
 * «Su pedido está pendiente de pago», UNA sola vez. Se queda con el pedido marcando
 * `aviso_pago_pendiente_en` en la misma sentencia (con las mismas condiciones: si dos corridas del cron
 * llegan juntas, o el pedido se pagó o canceló en el medio, sólo manda quien lo marca) y recién después
 * envía. Nunca lanza. Devuelve si le tocó avisar.
 */
export async function avisarPagoPendiente(pedidoId: string, ahora = new Date()): Promise<boolean> {
  try {
    const [marcado] = await getDb()
      .update(orders)
      .set({ avisoPagoPendienteEn: ahora })
      .where(and(eq(orders.id, pedidoId), condicionesAvisoPagoPendiente(ahora)))
      .returning({ id: orders.id });
    if (!marcado) return false;
    await enviarAviso(pedidoId, "pago_pendiente", `pedido/${pedidoId}/pago_pendiente`);
    return true;
  } catch (err) {
    console.error(`[avisos pedido] ${pedidoId}: no se pudo avisar el pago pendiente`, err);
    return false;
  }
}

/**
 * ¿Se avisa al crear el pedido (al comprador y al local)? Con pago en línea no: los dos avisos
 * salen cuando se aprueba el cobro (`avisarCobro`), para no anunciar pedidos que nunca se pagan.
 */
export function avisoOperadorAlCrear(pagoMetodo: string): boolean {
  return !esPagoEnLinea(pagoMetodo);
}

/** `CRM_ADMIN_URL` + ruta del pedido en el administrador; null sin la variable. */
function urlPedidoAdmin(id: string, base = process.env.CRM_ADMIN_URL): string | null {
  const b = base?.trim().replace(/\/+$/, "");
  if (!b || !/^https?:\/\//.test(b)) return null;
  return `${b}/admin/pedidos/${encodeURIComponent(id)}`;
}

/**
 * "Nuevo pedido", al local. Destino: `sucursales.email_pedidos` de la sucursal del pedido; si falta,
 * `tenants.receipts_email`; si tampoco, no se manda nada (sólo se loguea, sin datos del comprador).
 * Nunca lanza. Quien llama descarta los pedidos repetidos.
 */
export async function avisarOperadorPedidoNuevo(
  pedidoId: string,
  /** Medio que tenía el pedido antes de que el comprador lo cambiara: el aviso es "Cambió el medio de pago". */
  cambio?: { medioAnterior: string },
): Promise<void> {
  try {
    const db = getDb();
    const tenantId = shopTenantId();
    const [pedido] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, pedidoId), eq(orders.tenantId, tenantId)))
      .limit(1);
    if (!pedido) return;

    // Cada lectura por su cuenta: que falle una no impide avisar con la otra.
    let sucursal: { nombre: string; emailPedidos: string | null } | undefined;
    if (pedido.sucursal) {
      try {
        [sucursal] = await db
          .select({ nombre: crmSucursales.nombre, emailPedidos: crmSucursales.emailPedidos })
          .from(crmSucursales)
          .where(and(eq(crmSucursales.tenantId, tenantId), eq(crmSucursales.slug, pedido.sucursal)))
          .limit(1);
      } catch (err) {
        console.error("[avisos pedido] no se pudo leer la sucursal:", err);
      }
    }
    let emailEmpresa: string | null = null;
    try {
      const [t] = await db
        .select({ receiptsEmail: crmTenants.receiptsEmail })
        .from(crmTenants)
        .where(eq(crmTenants.id, tenantId))
        .limit(1);
      emailEmpresa = t?.receiptsEmail ?? null;
    } catch (err) {
      console.error("[avisos pedido] no se pudo leer el email de la empresa:", err);
    }

    const to = destinoAvisoOperador(sucursal?.emailPedidos, emailEmpresa);
    if (!to) {
      console.warn(`[avisos pedido] ${pedidoId} operador: sin email de destino (sucursal ni empresa)`);
      return;
    }

    let comercio = "";
    try {
      comercio = (await datosTenant())?.nombre ?? "";
    } catch (err) {
      console.error("[avisos pedido] no se pudieron leer los datos del tenant:", err);
    }
    const lineas = await db
      .select({ nombre: orderItems.name, cantidad: orderItems.qty, ventaSinStock: orderItems.ventaSinStock })
      .from(orderItems)
      .where(eq(orderItems.orderId, pedidoId))
      .orderBy(asc(orderItems.id));

    const sitio = sitioParaMailDelPedido(pedido.sitioOrigen);
    const mail = armarMailPedidoOperador({
      numero: `PED-${String(pedido.numero).padStart(8, "0")}`,
      comercio: comercio || "Tienda",
      sucursal: sucursal?.nombre ?? pedido.sucursal,
      contactoNombre: pedido.contactoNombre,
      contactoTelefono: pedido.contactoTelefono,
      clienteEmail: pedido.clienteEmail,
      lineas: lineas.map(lineaParaMail),
      total: Number(pedido.total),
      cupon: cuponParaResumen(pedido.cupon),
      entrega: etiquetaEntrega(pedido.entregaTipo, pedido.entregaCiudad, pedido.entregaDireccion),
      pago: nombreDelPago(pedido.pagoMetodo, null),
      ...(pedido.pagoCuotas && pedido.pagoTotalPagado
        ? { pagado: { total: Number(pedido.pagoTotalPagado), cuotas: pedido.pagoCuotas } }
        : {}),
      pedidoUrl: urlPedidoAdmin(pedidoId),
      logoUrl: urlLogoMarca(await getMarca(), sitio),
      sitioUrl: urlSitioMail(sitio),
      ...(cambio ? { medioAnterior: nombreDelPago(cambio.medioAnterior, null) } : {}),
    });

    const replyTo = looksLikeEmail(pedido.clienteEmail?.trim() ?? null) ? pedido.clienteEmail!.trim() : undefined;
    const r = await enviarEmail({
      to,
      ...mail,
      ...(replyTo ? { replyTo } : {}),
      tags: [{ name: "tipo", value: "pedido_operador" }],
      idempotencyKey: cambio
        ? `pedido/${pedidoId}/operador/cambio/${cambio.medioAnterior}-${pedido.pagoMetodo}`
        : `pedido/${pedidoId}/operador`,
    });
    if (r.ok) console.log(`[avisos pedido] ${pedidoId} operador: enviado`);
    else if (!r.noConfigurado) console.error(`[avisos pedido] ${pedidoId} operador: ${r.error}`);
  } catch (err) {
    console.error(`[avisos pedido] ${pedidoId} operador: no se pudo enviar`, err);
  }
}
