// Link firmado «Pagar su pedido» de los mails a un invitado (change `compra-como-invitado`, S3b).
// SOLO servidor.
//
// Es una COPIA MÍNIMA del firmante del Shop (`apps/clientes/src/lib/pedido-token.ts` y
// `pedido-link-pago.ts`): sólo firma el propósito `pago`, nunca verifica. Las dos apps no comparten
// código, así que el formato queda atado por un vector fijo (`__fixtures__/pedido-token-vector.json`,
// el MISMO archivo que usa el Shop): si cambia uno, el test del otro lo detecta.
//
// Formato: `v1.<orderId>.<expBase36>.<firma>` con
// `firma = base64url(HMAC-SHA256(subclave(propósito), "v1|<propósito>|<tenant>|<orderId>|<exp>"))` y
// `subclave = HMAC-SHA256(PEDIDO_LINK_SECRET, propósito)`. El tenant no viaja en el token: es el del
// pedido. Falla cerrada: sin `PEDIDO_LINK_SECRET` (o con menos de 32 caracteres) no se firma nada.

import { createHmac } from "crypto"

export type PropositoToken = "compra" | "pago"

const LARGO_MINIMO_SECRETO = 32
const VERSION = "v1"

/** Techo del link, contado desde que se creó el pedido, aunque la reserva no venza nunca. */
export const TECHO_LINK_PAGO_MS = 30 * 24 * 60 * 60_000
/** Sin reserva finita: pago en línea 24 h (la ventana de cobro). */
export const VIDA_LINK_EN_LINEA_MS = 24 * 60 * 60_000

function secreto(): string | null {
  const v = process.env.PEDIDO_LINK_SECRET
  return v && v.length >= LARGO_MINIMO_SECRETO ? v : null
}

/** Firma un token; null si no hay secreto válido (el mail sale sin botón). */
export function firmarToken(p: {
  proposito: PropositoToken
  orderId: string
  /** Epoch ms en que deja de valer. */
  venceEn: number
  tenant: string
}): string | null {
  const clave = secreto()
  if (!clave) return null
  const subclave = createHmac("sha256", clave).update(p.proposito).digest()
  const firma = createHmac("sha256", subclave)
    .update(`${VERSION}|${p.proposito}|${p.tenant}|${p.orderId}|${p.venceEn}`)
    .digest("base64url")
  return `${VERSION}.${p.orderId}.${p.venceEn.toString(36)}.${firma}`
}

/** Hasta cuándo (epoch ms) vale el link de un pedido en línea. Puro. */
export function venceEnLinkPago(p: {
  creadoEn: number
  /** Epoch ms; null = no vence (`infinity`) o desconocido. */
  reservaVenceEn: number | null
}): number {
  const techo = p.creadoEn + TECHO_LINK_PAGO_MS
  const finito = p.reservaVenceEn !== null && Number.isFinite(p.reservaVenceEn)
  const base = finito ? (p.reservaVenceEn as number) : p.creadoEn + VIDA_LINK_EN_LINEA_MS
  return Math.min(base, techo)
}

/** Token `pago` del pedido, o null si no se puede firmar. */
export function tokenLinkPago(p: {
  orderId: string
  tenant: string
  creadoEn: number
  reservaVenceEn: number | null
}): string | null {
  return firmarToken({
    proposito: "pago",
    orderId: p.orderId,
    tenant: p.tenant,
    venceEn: venceEnLinkPago(p),
  })
}
