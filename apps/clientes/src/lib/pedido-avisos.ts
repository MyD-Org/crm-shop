/**
 * Envío de los mails al comprador sobre su pedido (ver `pedido-mail.ts`). SOLO servidor.
 *
 * Se llaman DESPUÉS de que el pedido o el cobro quedaron guardados y NUNCA lanzan: un mail que
 * no sale no puede tumbar un pedido ni hacer que Mercado Pago reintente un webhook. El
 * resultado sólo se loguea, sin datos del comprador.
 *
 * No importa `pedidos.ts` (que es quien llama a `avisarCobro`): lee el pedido por su cuenta.
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmSucursales, crmTenants } from "@/db/crm";
import { orderItems, orders } from "@/db/schema";
import { datosTenant } from "./cuenta-corriente/tenant-cc";
import { enviarEmail } from "./email";
import { etiquetaEntrega } from "./envio";
import { contactoDeSucursal } from "./contacto-pedido-repo";
import { nombreDelPago } from "./medios-pago";
import { leerMediosPagoTolerante } from "./medios-pago-repo";
import { urlSitioMail } from "./mail-layout";
import {
  armarMailPedido,
  armarMailPedidoOperador,
  destinoAvisoOperador,
  transferenciaParaMail,
  type AvisoPedidoShop,
} from "./pedido-mail";
import { shopTenantId } from "./tenant";
import { urlLogoMail } from "./vinculacion-mail";

const RUTA_PEDIDOS = "/mi-cuenta/pedidos";

function looksLikeEmail(s: string | null): s is string {
  return typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

function urlPedidos(sitio = process.env.NEXT_PUBLIC_SITE_URL): string | null {
  if (!sitio) return null;
  try {
    return new URL(RUTA_PEDIDOS, sitio).toString();
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

    const lineas =
      aviso === "recibido"
        ? await getDb()
            .select({ nombre: orderItems.name, cantidad: orderItems.qty })
            .from(orderItems)
            .where(eq(orderItems.orderId, pedidoId))
            .orderBy(asc(orderItems.id))
        : [];

    // En el "recibido": el pago con el nombre del medio del CRM y el plazo + WhatsApp de la
    // sucursal. Lecturas que no tiran.
    const numero = `PED-${String(pedido.numero).padStart(8, "0")}`;
    const recibido = aviso === "recibido";
    const medios = recibido ? await leerMediosPagoTolerante() : null;
    const contacto = recibido ? await contactoDeSucursal(pedido.sucursal, numero) : null;

    const mail = armarMailPedido({
      aviso,
      numero,
      contactoNombre: pedido.contactoNombre,
      comercio: comercio || "Su pedido",
      logoUrl: urlLogoMail(),
      pedidosUrl: urlPedidos(),
      sitioUrl: urlSitioMail(),
      lineas: lineas.map((l) => ({ nombre: l.nombre, cantidad: Number(l.cantidad) })),
      total: Number(pedido.total),
      entrega: etiquetaEntrega(pedido.entregaTipo, pedido.entregaCiudad, pedido.entregaDireccion),
      pago: nombreDelPago(pedido.pagoMetodo, medios),
      pagoPendienteEnLinea: pedido.pagoMetodo === "mercadopago" && pedido.pagoEstado !== "pagado",
      // Transferencia: la cuenta congelada en el pedido (nunca se vuelve a resolver).
      ...(aviso === "recibido" && transferenciaParaMail(pedido.pagoMetodo, pedido.pagoCuenta)
        ? { transferencia: transferenciaParaMail(pedido.pagoMetodo, pedido.pagoCuenta) }
        : {}),
      ...(contacto
        ? {
            contacto: {
              mensaje: contacto.mensaje,
              ...(contacto.whatsapp
                ? { whatsappVisible: contacto.whatsapp.visible, whatsappUrl: contacto.whatsapp.url }
                : {}),
            },
          }
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

/** "Recibimos su pedido", al crearlo. Quien llama descarta los pedidos repetidos. */
export function avisarPedidoRecibido(pedidoId: string): Promise<void> {
  return enviarAviso(pedidoId, "recibido", `pedido/${pedidoId}/recibido`);
}

/** Aviso del cobro en línea, si corresponde (ver `avisoDelCobro`). */
export async function avisarCobro(
  pedidoId: string,
  cambio: { antes: string; despues: string; reversion: boolean; referencia: string },
): Promise<void> {
  const aviso = avisoDelCobro(cambio.antes, cambio.despues, cambio.reversion);
  if (!aviso) return;
  await enviarAviso(pedidoId, aviso, `pedido/${pedidoId}/${aviso}/${cambio.referencia || "sin-ref"}`);
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
export async function avisarOperadorPedidoNuevo(pedidoId: string): Promise<void> {
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
      .select({ nombre: orderItems.name, cantidad: orderItems.qty })
      .from(orderItems)
      .where(eq(orderItems.orderId, pedidoId))
      .orderBy(asc(orderItems.id));

    const mail = armarMailPedidoOperador({
      numero: `PED-${String(pedido.numero).padStart(8, "0")}`,
      comercio: comercio || "Tienda",
      sucursal: sucursal?.nombre ?? pedido.sucursal,
      contactoNombre: pedido.contactoNombre,
      contactoTelefono: pedido.contactoTelefono,
      clienteEmail: pedido.clienteEmail,
      lineas: lineas.map((l) => ({ nombre: l.nombre, cantidad: Number(l.cantidad) })),
      total: Number(pedido.total),
      entrega: etiquetaEntrega(pedido.entregaTipo, pedido.entregaCiudad, pedido.entregaDireccion),
      pago: nombreDelPago(pedido.pagoMetodo, null),
      pedidoUrl: urlPedidoAdmin(pedidoId),
      logoUrl: urlLogoMail(),
      sitioUrl: urlSitioMail(),
    });

    const replyTo = looksLikeEmail(pedido.clienteEmail?.trim() ?? null) ? pedido.clienteEmail!.trim() : undefined;
    const r = await enviarEmail({
      to,
      ...mail,
      ...(replyTo ? { replyTo } : {}),
      tags: [{ name: "tipo", value: "pedido_operador" }],
      idempotencyKey: `pedido/${pedidoId}/operador`,
    });
    if (r.ok) console.log(`[avisos pedido] ${pedidoId} operador: enviado`);
    else if (!r.noConfigurado) console.error(`[avisos pedido] ${pedidoId} operador: ${r.error}`);
  } catch (err) {
    console.error(`[avisos pedido] ${pedidoId} operador: no se pudo enviar`, err);
  }
}
