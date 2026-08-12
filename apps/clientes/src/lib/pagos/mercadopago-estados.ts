/**
 * Traducción de los estados de Mercado Pago a los nuestros. Módulo PURO.
 *
 * Vive separado del cliente HTTP a propósito: acá está la lógica que decide qué
 * ve el comprador cuando le rechazan la tarjeta, y esa lógica se testea sin
 * red, sin credenciales y sin tocar Mercado Pago.
 *
 * Se mapea la API `/v1/payments` (`approved` / `in_process` / `pending` /
 * `rejected`), que es la que documenta Checkout Bricks. Ver la §10 de
 * docs/pagos-mercadopago.md para por qué no la Orders API.
 */

import type { MotivoRechazo } from "./tipos";
import type { PagoEstado } from "@/data/orders";

/**
 * `status_detail` de un pago rechazado → motivo nuestro.
 *
 * Lo que NO está en esta tabla cae en `desconocido`, que es el comportamiento
 * correcto: MP agrega códigos sin avisar, y es preferible un mensaje genérico
 * que un `undefined` paseándose por el checkout.
 */
const RECHAZOS: Record<string, MotivoRechazo> = {
  // Se arreglan reescribiendo la tarjeta.
  cc_rejected_bad_filled_card_number: "datos_invalidos",
  cc_rejected_bad_filled_date: "datos_invalidos",
  cc_rejected_bad_filled_security_code: "datos_invalidos",
  cc_rejected_bad_filled_other: "datos_invalidos",

  // Se arreglan con otra tarjeta o por transferencia.
  cc_rejected_insufficient_amount: "fondos",
  cc_amount_rate_limit_exceeded: "limite",
  cc_rejected_invalid_installments: "cuotas_no_disponibles",

  // Requieren que el cliente llame al banco.
  cc_rejected_call_for_authorize: "requiere_autorizacion",
  cc_rejected_card_disabled: "tarjeta_inhabilitada",
  cc_rejected_other_reason: "banco_rechazo",
  cc_rejected_card_error: "banco_rechazo",

  // Reintentar acá es lo peor que puede hacer.
  cc_rejected_duplicated_payment: "duplicado",
  cc_rejected_max_attempts: "demasiados_intentos",

  // Antifraude. El motivo real nunca se le explica al comprador.
  cc_rejected_high_risk: "riesgo",
  cc_rejected_blacklist: "riesgo",
};

/**
 * Estados de MP que son "todavía no se sabe".
 *
 * `pending_challenge` es 3DS: el banco quiere validar al titular y el pago
 * queda esperando. No es un rechazo — tratarlo como tal perdería ventas que
 * están a un paso de aprobarse.
 */
const PENDIENTES = new Set([
  "pending_challenge",
  "pending_contingency",
  "pending_review_manual",
  "pending_capture",
  "pending_waiting_payment",
  "pending_waiting_transfer",
]);

/** Forma mínima de la respuesta de MP que nos interesa. */
export interface RespuestaMercadoPago {
  id?: number | string;
  status?: string;
  status_detail?: string;
  three_ds_info?: { external_resource_url?: string; creq?: string };
}

/**
 * ¿En qué estado nuestro cae este pago?
 *
 * Solo `approved` cuenta como pagado. Todo lo que no sea explícitamente
 * aprobado, rechazado o pendiente conocido se trata como **pendiente**, no como
 * fallido: dar por perdido un pago que MP todavía está resolviendo sería
 * cancelarle la compra a alguien que sí pagó.
 */
export function estadoDeMercadoPago(status: string | undefined): PagoEstado {
  if (status === "approved" || status === "authorized") return "pagado";
  if (status === "rejected" || status === "cancelled") return "fallido";
  return "pendiente";
}

/**
 * Motivo del rechazo, en términos nuestros. `undefined` si el pago no está
 * rechazado — un motivo en un pago aprobado sería una contradicción.
 */
export function motivoDeMercadoPago(
  status: string | undefined,
  statusDetail: string | undefined,
): MotivoRechazo | undefined {
  if (estadoDeMercadoPago(status) !== "fallido") return undefined;
  if (!statusDetail) return "desconocido";
  return RECHAZOS[statusDetail] ?? "desconocido";
}

/**
 * ¿Hay un desafío 3DS para renderizar?
 *
 * Se exige `pending_challenge` Y los dos campos: sin `external_resource_url` o
 * sin `creq` no hay nada que mostrar, y devolver un desafío incompleto haría
 * que el Status Screen Brick falle en pantalla.
 */
export function desafio3DS(pago: RespuestaMercadoPago) {
  if (pago.status_detail !== "pending_challenge") return undefined;
  const url = pago.three_ds_info?.external_resource_url;
  const creq = pago.three_ds_info?.creq;
  if (!url || !creq) return undefined;
  return { externalResourceUrl: url, creq };
}

/** ¿Es un estado pendiente que Mercado Pago reconoce? Para observabilidad. */
export function esPendienteConocido(statusDetail: string | undefined): boolean {
  return statusDetail != null && PENDIENTES.has(statusDetail);
}
