/**
 * Link «Pagar su pedido» de los mails al invitado (change `compra-como-invitado`, S3). SOLO servidor.
 *
 * Es un token de propósito `pago` (ver `pedido-token.ts`): vale lo que dura la reserva del pedido, con
 * un techo de 30 días, y NO se acepta en la API. La página `/pagar/[token]` lo verifica y lo canjea por
 * un token de `compra` (vida corta). Nada se guarda en el navegador ni en la base.
 */
import { sql } from "drizzle-orm";
import { orders } from "@/db/schema";
import { firmarToken } from "./pedido-token";

/** Techo del link, contado desde que se creó el pedido, aunque la reserva no venza nunca. */
export const TECHO_LINK_PAGO_MS = 30 * 24 * 60 * 60_000;
/** Sin reserva finita: pago en línea 24 h (la ventana de cobro), transferencia 7 días. */
export const VIDA_LINK_EN_LINEA_MS = 24 * 60 * 60_000;
export const VIDA_LINK_TRANSFERENCIA_MS = 7 * 24 * 60 * 60_000;

/**
 * `reserva_vence_en` como epoch ms, o NULL si no vence (`infinity`) o no hay. Se pide así a la base
 * porque un `timestamptz` infinito no pasa por el driver como una fecha válida.
 */
export const reservaVenceMsSql = sql<number | null>`case
  when ${orders.reservaVenceEn} is null or ${orders.reservaVenceEn} = 'infinity'::timestamptz or ${orders.reservaVenceEn} = '-infinity'::timestamptz then null
  else floor(extract(epoch from ${orders.reservaVenceEn}) * 1000)::float8
end`;

/** Hasta cuándo (epoch ms) vale el link de un pedido. Puro. */
export function venceEnLinkPago(p: {
  creadoEn: number;
  /** Epoch ms; null = sin vencimiento o desconocido. */
  reservaVenceEn: number | null;
  enLinea: boolean;
}): number {
  const techo = p.creadoEn + TECHO_LINK_PAGO_MS;
  const finito = p.reservaVenceEn !== null && Number.isFinite(p.reservaVenceEn);
  const base = finito
    ? (p.reservaVenceEn as number)
    : p.creadoEn + (p.enLinea ? VIDA_LINK_EN_LINEA_MS : VIDA_LINK_TRANSFERENCIA_MS);
  return Math.min(base, techo);
}

/** Token `pago` del pedido, o null si no se puede firmar (sin `PEDIDO_LINK_SECRET`): el mail sale sin botón. */
export function tokenLinkPago(p: {
  orderId: string;
  creadoEn: number;
  reservaVenceEn: number | null;
  enLinea: boolean;
}): string | null {
  try {
    return firmarToken({ proposito: "pago", orderId: p.orderId, venceEn: venceEnLinkPago(p) });
  } catch {
    return null;
  }
}
