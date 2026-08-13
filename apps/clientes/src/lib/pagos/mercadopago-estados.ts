/**
 * Traducción de los estados de la Orders API de Mercado Pago. Módulo PURO.
 *
 * Vive separado del cliente HTTP a propósito: acá está la lógica que decide qué
 * ve el comprador cuando le rechazan la tarjeta, y esa lógica se testea sin
 * red, sin credenciales y sin tocar Mercado Pago.
 *
 * Se mapea la **Orders API** (`POST /v1/orders`), no `/v1/payments`: MP marca
 * esa última como *legacy* en su propio panel, y Orders acepta el token que
 * genera Checkout Bricks. Ver §10 de docs/pagos-mercadopago.md.
 */

import type { MotivoRechazo } from "./tipos";
import type { PagoEstado } from "@/data/orders";

/**
 * `status_detail` de una transacción fallida → motivo nuestro.
 *
 * Lo que NO está acá cae en `desconocido`, que es el comportamiento correcto:
 * MP agrega códigos sin avisar, y es preferible un mensaje genérico que un
 * `undefined` paseándose por el checkout.
 */
const RECHAZOS: Record<string, MotivoRechazo> = {
  // Se arreglan reescribiendo la tarjeta en el formulario.
  bad_filled_card_data: "datos_invalidos",

  // Se arreglan con otra tarjeta, otras cuotas, o por transferencia.
  insufficient_amount: "fondos",
  card_insufficient_amount: "fondos",
  amount_limit_exceeded: "limite",
  invalid_installments: "cuotas_no_disponibles",

  // Requieren que el comprador hable con su banco.
  rejected_by_issuer: "banco_rechazo",
  required_call_for_authorize: "requiere_autorizacion",
  card_disabled: "tarjeta_inhabilitada",

  // Reintentar YA es lo peor que puede hacer.
  max_attempts_exceeded: "demasiados_intentos",

  // Antifraude. El motivo real nunca se le explica al comprador.
  high_risk: "riesgo",

  /**
   * El desafío del banco venció (el comprador tiene ~40 minutos). Se reintenta
   * y listo — decirle "revisá los datos de tu tarjeta" sería mandarlo a buscar
   * un problema que no existe.
   */
  "3ds_challenge_expired": "desafio_vencido",

  /**
   * Token vencido o ya usado: los de Bricks son de un solo uso. Rehacer el
   * formulario genera uno nuevo, así que alcanza con "probá de nuevo".
   */
  invalid_card_token: "desconocido",
  processing_error: "desconocido",
};

/** Estados de orden que significan "todavía no se sabe". */
const PENDIENTES = new Set([
  "created",
  "processing",
  "action_required",
  "in_review",
]);

/**
 * Estados donde la plata NO está con nosotros aunque en algún momento lo haya
 * estado. Un contracargo es la única transición legítima de `pagado` a
 * `fallido`: el resto de las bajadas desde `pagado` son eventos desordenados y
 * hay que ignorarlas.
 */
const PERDIDOS = new Set(["failed", "canceled", "expired", "refunded", "charged_back"]);

/** Forma mínima de la respuesta de Orders que nos interesa. */
export interface RespuestaMercadoPago {
  id?: number | string;
  status?: string;
  status_detail?: string;
  transactions?: {
    payments?: Array<{
      id?: string;
      status?: string;
      status_detail?: string;
      three_ds_info?: { external_resource_url?: string; creq?: string };
    }>;
  };
}

/**
 * El detalle fino vive en la transacción; el estado general, en la orden.
 *
 * Se prefiere el de la transacción cuando está: una orden `failed` no dice POR
 * QUÉ falló, y ese "por qué" es lo único que le sirve al comprador.
 */
function transaccion(orden: RespuestaMercadoPago) {
  return orden.transactions?.payments?.[0];
}

export function statusEfectivo(orden: RespuestaMercadoPago): string | undefined {
  return transaccion(orden)?.status ?? orden.status;
}

export function detalleEfectivo(orden: RespuestaMercadoPago): string | undefined {
  return transaccion(orden)?.status_detail ?? orden.status_detail;
}

/**
 * ¿En qué estado nuestro cae esta orden?
 *
 * Solo `processed` cuenta como pagado. Todo lo que no sea explícitamente
 * procesado o explícitamente perdido se trata como **pendiente**, no como
 * fallido: dar por perdido un pago que MP todavía está resolviendo sería
 * cancelarle la compra a alguien que sí pagó.
 */
export function estadoDeMercadoPago(status: string | undefined): PagoEstado {
  if (status === "processed") return "pagado";
  if (status && PERDIDOS.has(status)) return "fallido";
  return "pendiente";
}

/**
 * Motivo del rechazo, en términos nuestros. `undefined` si la orden no está
 * caída — un motivo de rechazo en un pago acreditado sería una contradicción.
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
 * Se exigen los dos campos: un desafío a medias hace fallar al Status Screen
 * Brick en pantalla, que es peor que no ofrecerlo — el comprador se queda sin
 * pago y sin explicación.
 */
export function desafio3DS(orden: RespuestaMercadoPago) {
  if (detalleEfectivo(orden) !== "pending_challenge") return undefined;
  const info = transaccion(orden)?.three_ds_info;
  const url = info?.external_resource_url;
  const creq = info?.creq;
  if (!url || !creq) return undefined;
  return { externalResourceUrl: url, creq };
}

/** ¿Es un estado pendiente que MP reconoce? Para observabilidad. */
export function esPendienteConocido(status: string | undefined): boolean {
  return status != null && PENDIENTES.has(status);
}

/**
 * Un contracargo o una devolución son la ÚNICA razón legítima para bajar un
 * pedido de `pagado`. Lo usa el webhook para no dejar que un evento desordenado
 * desmarque un pago bueno.
 */
export function esReversion(status: string | undefined): boolean {
  return status === "charged_back" || status === "refunded";
}
