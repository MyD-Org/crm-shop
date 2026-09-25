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
import { orderItems, orders } from "@/db/schema";
import { datosTenant } from "./cuenta-corriente/tenant-cc";
import { enviarEmail } from "./email";
import { ENTREGA_LABEL, PAGO_LABEL, type EntregaTipo, type PagoMetodo } from "./envio";
import { armarMailPedido, type AvisoPedidoShop } from "./pedido-mail";
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

async function enviarAviso(pedidoId: string, aviso: AvisoPedidoShop, clave: string): Promise<void> {
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

    const mail = armarMailPedido({
      aviso,
      numero: `PED-${String(pedido.numero).padStart(8, "0")}`,
      contactoNombre: pedido.contactoNombre,
      comercio: comercio || "Su pedido",
      logoUrl: urlLogoMail(),
      pedidosUrl: urlPedidos(),
      lineas: lineas.map((l) => ({ nombre: l.nombre, cantidad: Number(l.cantidad) })),
      total: Number(pedido.total),
      entrega: ENTREGA_LABEL[pedido.entregaTipo as EntregaTipo],
      pago: PAGO_LABEL[pedido.pagoMetodo as PagoMetodo],
      pagoPendienteEnLinea: pedido.pagoMetodo === "mercadopago" && pedido.pagoEstado !== "pagado",
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
