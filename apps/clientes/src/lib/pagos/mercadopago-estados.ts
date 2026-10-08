/**
 * Traducción de los estados de la Payments API de Mercado Pago. Módulo PURO.
 *
 * Vive separado del cliente HTTP a propósito: acá está la lógica que decide qué
 * ve el comprador cuando le rechazan la tarjeta, y esa lógica se testea sin
 * red, sin credenciales y sin tocar Mercado Pago.
 *
 * Se mapea la **Payments API** (`POST /v1/payments`), no `/v1/orders`. La razón
 * es concreta: la Orders API RECHAZA credenciales TEST- con
 * `"Test credentials are not supported"`, y hoy no tenemos credenciales de
 * producción homologadas — sin este endpoint no se puede probar nada. Payments
 * API está marcada como "legacy" por MP en su panel, pero no está deprecada y
 * sigue siendo la que la mayoría de integraciones usan. Cuando llegue la
 * homologación se puede volver a Orders.
 *
 * OJO: los `status_detail` NO son los mismos. La Payments API rechaza con `cc_rejected_*`
 * (`cc_rejected_other_reason`, `cc_rejected_high_risk`, …); la Orders API, con los cortos
 * (`rejected_by_issuer`, `high_risk`, …). Se mapean los dos: con sólo los de Orders, todo rechazo
 * real de la Payments API caía en `desconocido` y el comprador veía el mensaje genérico.
 */

import type { InfoPago, MotivoRechazo, TipoMedioPago } from "./tipos";
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

  // Payments API (`POST /v1/payments`, la que usamos): los mismos motivos con los códigos `cc_rejected_*`.
  cc_rejected_bad_filled_card_number: "datos_invalidos",
  cc_rejected_bad_filled_date: "datos_invalidos",
  cc_rejected_bad_filled_security_code: "datos_invalidos",
  cc_rejected_bad_filled_other: "datos_invalidos",
  cc_rejected_insufficient_amount: "fondos",
  cc_amount_rate_limit_exceeded: "limite",
  cc_rejected_invalid_installments: "cuotas_no_disponibles",
  cc_rejected_call_for_authorize: "requiere_autorizacion",
  cc_rejected_card_disabled: "tarjeta_inhabilitada",
  cc_rejected_max_attempts: "demasiados_intentos",
  cc_rejected_high_risk: "riesgo",
  cc_rejected_blacklist: "riesgo",
  rejected_high_risk: "riesgo",
  cc_rejected_3ds_challenge: "validacion_banco",
  // 3DS obligatorio (ver `modo3DS`) con una tarjeta o un banco que no lo admite.
  cc_rejected_3ds_mandatory: "sin_3ds",
  // Sin motivo dado por el banco, tarjeta no admitida para la compra o pago repetido por el mismo monto:
  // en los tres sirve otra tarjeta u otro medio.
  cc_rejected_other_reason: "no_aprobado",
  cc_rejected_card_error: "no_aprobado",
  cc_rejected_card_type_not_allowed: "no_aprobado",
  cc_rejected_duplicated_payment: "no_aprobado",
  rejected_by_bank: "no_aprobado",
};

/** Estados de pago que significan "todavía no se sabe". */
const PENDIENTES = new Set([
  "pending",
  "in_process",
  "in_mediation",
  "authorized",
]);

/**
 * Estados donde la plata NO está con nosotros aunque en algún momento lo haya
 * estado. Un contracargo es la única transición legítima de `pagado` a
 * `fallido`: el resto de las bajadas desde `pagado` son eventos desordenados y
 * hay que ignorarlas.
 */
const PERDIDOS = new Set(["rejected", "cancelled", "refunded", "charged_back"]);

/**
 * Forma mínima de la respuesta de Payments que nos interesa. Payments API
 * devuelve todo plano en el root — a diferencia de Orders, que anidaba en
 * `transactions.payments[0]`.
 */
export interface RespuestaMercadoPago {
  id?: number | string;
  status?: string;
  status_detail?: string;
  /** Lo que mandamos al crear el pago: el id de nuestro pedido. */
  external_reference?: string | null;
  three_ds_info?: { external_resource_url?: string; creq?: string };
  /** Cuotas con las que se cobró (las que eligió el comprador en el Brick). */
  installments?: number;
  /** `total_paid_amount` incluye el interés de las cuotas. */
  transaction_details?: { total_paid_amount?: number };
  /** 'credit_card' | 'debit_card' | 'prepaid_card' | 'account_money' | … */
  payment_type_id?: string;
  /** 'visa' | 'master' | 'debvisa' | 'account_money' | … */
  payment_method_id?: string;
  /** Sólo lo que se guarda: nunca el titular ni los primeros dígitos. */
  card?: { last_four_digits?: string | null } | null;
  date_approved?: string | null;
  authorization_code?: string | null;
}

export function statusEfectivo(pago: RespuestaMercadoPago): string | undefined {
  return pago.status;
}

export function detalleEfectivo(pago: RespuestaMercadoPago): string | undefined {
  return pago.status_detail;
}

/**
 * ¿En qué estado nuestro cae este pago?
 *
 * Solo `approved` cuenta como pagado. Todo lo que no sea explícitamente
 * aprobado o explícitamente perdido se trata como **pendiente**, no como
 * fallido: dar por perdido un pago que MP todavía está resolviendo sería
 * cancelarle la compra a alguien que sí pagó.
 */
export function estadoDeMercadoPago(status: string | undefined): PagoEstado {
  if (status === "approved") return "pagado";
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
export function desafio3DS(pago: RespuestaMercadoPago) {
  if (detalleEfectivo(pago) !== "pending_challenge") return undefined;
  const url = pago.three_ds_info?.external_resource_url;
  const creq = pago.three_ds_info?.creq;
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

/* ───────────────────────────── medio con el que se cobró ───────────────────────────── */

const TIPOS_MP: Record<string, TipoMedioPago> = {
  credit_card: "credito",
  debit_card: "debito",
  prepaid_card: "prepaga",
  account_money: "dinero_en_cuenta",
};

/** `payment_method_id` de Mercado Pago → marca legible. Uno desconocido se muestra con su id. */
const MARCAS_MP: Record<string, string> = {
  visa: "Visa",
  debvisa: "Visa",
  master: "Mastercard",
  debmaster: "Mastercard",
  maestro: "Maestro",
  amex: "American Express",
  cabal: "Cabal",
  debcabal: "Cabal",
  naranja: "Naranja",
  nativa: "Nativa",
  cencosud: "Cencosud",
  cmr: "CMR",
  diners: "Diners",
  tarshop: "Tarjeta Shopping",
  argencard: "Argencard",
};

const texto = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Con qué pagó el comprador, según el pago de Mercado Pago. Sólo marca, tipo, últimos 4, fecha de
 * aprobación y código de autorización: nunca el titular ni el BIN. `{}` si no informó nada.
 */
export function infoDeMercadoPago(pago: RespuestaMercadoPago): { info?: InfoPago } {
  const info: InfoPago = {};
  const tipoId = texto(pago.payment_type_id);
  if (tipoId && Object.hasOwn(TIPOS_MP, tipoId)) info.tipo = TIPOS_MP[tipoId];
  const metodo = texto(pago.payment_method_id)?.toLowerCase();
  if (metodo && metodo !== "account_money") {
    info.marca = Object.hasOwn(MARCAS_MP, metodo) ? MARCAS_MP[metodo] : metodo;
  }
  const ultimos4 = texto(pago.card?.last_four_digits);
  if (ultimos4 && /^\d{4}$/.test(ultimos4)) info.ultimos4 = ultimos4;
  const aprobadoEn = texto(pago.date_approved);
  if (aprobadoEn && !Number.isNaN(Date.parse(aprobadoEn))) info.aprobadoEn = new Date(aprobadoEn).toISOString();
  const autorizacion = texto(pago.authorization_code);
  if (autorizacion) info.autorizacion = autorizacion;
  return Object.keys(info).length > 0 ? { info } : {};
}
