/**
 * Token firmado del pedido de un invitado (change `compra-como-invitado`). SOLO servidor.
 *
 * Reemplaza a la sesión: nada se guarda en el navegador ni en la base. El token se verifica sin
 * almacén de sesiones: `v1.<orderId>.<expBase36>.<firma>`, con
 * `firma = base64url(HMAC-SHA256(subclave(propósito), "v1|<propósito>|<tenant>|<orderId>|<exp>"))`.
 *
 * Dos propósitos con subclaves derivadas del mismo secreto, para que uno no sirva como el otro:
 *  - `compra`: lo entrega `POST /api/pedidos` al crear el pedido; vive en la memoria de la página y
 *    en la URL de retorno de Mercado Pago / Payway; vence en horas (`TTL_TOKEN_COMPRA_MS`).
 *  - `pago`: el link «Pagar su pedido» de los mails; vale lo que dure la reserva (con techo).
 *
 * El tenant NO viaja en el token: sale de `shopTenantId()` del servidor, así un token de otro
 * tenant firma distinto y se rechaza. La comparación de la firma es en tiempo constante
 * (`secureCompare`) y falla cerrada: sin `PEDIDO_LINK_SECRET` (o menor a 32 caracteres) no se firma
 * ni se verifica nada.
 *
 * El CRM acuña el link `pago` para sus mails de estado con un firmante duplicado
 * (`apps/admin/src/lib/pedido-link.ts`, rebanada S3b). El vector fijo de
 * `__fixtures__/pedido-token-vector.json` lo ata a este formato: si cambia uno, cambia el otro.
 */
import { createHmac } from "crypto";
import { secureCompare } from "./secure-compare";
import { shopTenantId } from "./tenant";

export type PropositoToken = "compra" | "pago";

/** Vida del token de la sesión de compra. Pasado esto, el invitado usa el link del mail. */
export const TTL_TOKEN_COMPRA_MS = 6 * 60 * 60_000;

const LARGO_MINIMO_SECRETO = 32;
const VERSION = "v1";
const PROPOSITOS: readonly PropositoToken[] = ["compra", "pago"];

/** Un token real mide ~110 caracteres: más que esto ni se mira. */
const LARGO_MAXIMO_TOKEN = 256;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE36 = /^[0-9a-z]{1,13}$/;
const FIRMA = /^[A-Za-z0-9_-]{43}$/;

export type ResultadoToken =
  | { ok: true; orderId: string; venceEn: number }
  | { ok: false; motivo: "formato" | "firma" | "vencido" | "proposito" | "secreto" };

export class SecretoPedidoFaltanteError extends Error {
  constructor() {
    super("Falta PEDIDO_LINK_SECRET (o es demasiado corto, mínimo 32 caracteres) para firmar los tokens del pedido.");
    this.name = "SecretoPedidoFaltanteError";
  }
}

function secreto(): string | null {
  const v = process.env.PEDIDO_LINK_SECRET;
  return v && v.length >= LARGO_MINIMO_SECRETO ? v : null;
}

/** ¿Se pueden firmar tokens? Las rutas lo consultan ANTES de crear un pedido: no se crea uno que no se puede autorizar. */
export function pedidoTokenConfigurado(): boolean {
  return secreto() !== null;
}

function subclave(clave: string, proposito: PropositoToken): Buffer {
  return createHmac("sha256", clave).update(proposito).digest();
}

function firmaDe(clave: string, p: { proposito: PropositoToken; orderId: string; venceEn: number; tenant: string }): string {
  return createHmac("sha256", subclave(clave, p.proposito))
    .update(`${VERSION}|${p.proposito}|${p.tenant}|${p.orderId}|${p.venceEn}`)
    .digest("base64url");
}

export function firmarToken(p: {
  proposito: PropositoToken;
  orderId: string;
  /** Epoch ms en que deja de valer. */
  venceEn: number;
  tenant?: string;
}): string {
  const clave = secreto();
  if (!clave) throw new SecretoPedidoFaltanteError();
  const tenant = p.tenant ?? shopTenantId();
  const firma = firmaDe(clave, { proposito: p.proposito, orderId: p.orderId, venceEn: p.venceEn, tenant });
  return `${VERSION}.${p.orderId}.${p.venceEn.toString(36)}.${firma}`;
}

/** Token de la sesión de compra de un pedido recién creado. */
export function acuñarTokenCompra(orderId: string, ahora: number = Date.now()): { token: string; venceEn: number } {
  const venceEn = ahora + TTL_TOKEN_COMPRA_MS;
  return { token: firmarToken({ proposito: "compra", orderId, venceEn }), venceEn };
}

/**
 * Verifica forma, firma, propósito y vencimiento. Orden deliberado: la firma se prueba ANTES que el
 * vencimiento, así un `exp` alterado se informa como `firma` y no como `vencido`. Vigente mientras
 * `ahora < venceEn`.
 */
export function verificarToken(
  token: string,
  proposito: PropositoToken,
  ahora: number = Date.now(),
  tenant?: string,
): ResultadoToken {
  if (typeof token !== "string" || token.length === 0 || token.length > LARGO_MAXIMO_TOKEN) {
    return { ok: false, motivo: "formato" };
  }
  const partes = token.split(".");
  if (partes.length !== 4) return { ok: false, motivo: "formato" };
  const [version, orderId, expBase36, firma] = partes;
  if (version !== VERSION || !UUID.test(orderId) || !BASE36.test(expBase36) || !FIRMA.test(firma)) {
    return { ok: false, motivo: "formato" };
  }

  const clave = secreto();
  if (!clave) return { ok: false, motivo: "secreto" };

  const venceEn = parseInt(expBase36, 36);
  if (!Number.isSafeInteger(venceEn)) return { ok: false, motivo: "formato" };
  const tenantEsperado = tenant ?? shopTenantId();

  const esperada = firmaDe(clave, { proposito, orderId, venceEn, tenant: tenantEsperado });
  if (!secureCompare(firma, esperada)) {
    // ¿Es válido para el otro propósito? Se informa distinto para poder diagnosticar un cruce.
    for (const otro of PROPOSITOS) {
      if (otro === proposito) continue;
      const deOtro = firmaDe(clave, { proposito: otro, orderId, venceEn, tenant: tenantEsperado });
      if (secureCompare(firma, deOtro)) return { ok: false, motivo: "proposito" };
    }
    return { ok: false, motivo: "firma" };
  }

  if (ahora >= venceEn) return { ok: false, motivo: "vencido" };
  return { ok: true, orderId, venceEn };
}
