/**
 * Preferencia de Mercado Pago para pagar con la cuenta de Mercado Pago. Módulo PURO: sin red ni secretos.
 *
 * El comprador va al sitio de Mercado Pago (`init_point`) con el botón "Ir a Mercado Pago": el pago no
 * pasa por nuestro `POST /v1/payments`, vuelve al sitio por `back_urls` y avisa por webhook. Todo sale
 * del pedido congelado, nunca del navegador.
 */

import { urlNotificacion } from "./mercadopago";

export interface DatosPreferencia {
  pedidoId: string;
  numero: string;
  /** Total del pedido congelado, en pesos. */
  total: number;
  /** Origen por el que entró el comprador (para volver al mismo entorno). */
  origen: string | null | undefined;
  emailComprador?: string;
  /** Cuotas congeladas en el pedido (1 o null = un pago): tope de cuotas dentro de Mercado Pago. */
  cuotas?: number | null;
}

export interface Preferencia {
  items: { id: string; title: string; quantity: 1; unit_price: number; currency_id: "ARS" }[];
  external_reference: string;
  purpose: "wallet_purchase";
  payment_methods: {
    installments: number;
    default_installments?: number;
    excluded_payment_methods: { id: string }[];
  };
  payer?: { email: string };
  back_urls?: { success: string; pending: string; failure: string };
  auto_return?: "approved";
  notification_url?: string;
}

/**
 * Tope de cuotas dentro de Mercado Pago = las cuotas elegidas en la tienda (el precio ya las incluye):
 * así nunca se financia más de lo cobrado. Sin cuotas válidas, un pago.
 */
export function cuotasPreferencia(cuotas: number | null | undefined): number {
  return typeof cuotas === "number" && Number.isInteger(cuotas) && cuotas >= 1 ? cuotas : 1;
}

/** A dónde vuelve el comprador. Mercado Pago rechaza back_urls que no sean https de dominio público. */
export function urlRetorno(origen: string | null | undefined, pedidoId: string): string | undefined {
  if (!urlNotificacion(origen)) return undefined; // misma regla: https y dominio público
  return `${new URL(origen as string).origin}/checkout?pedido=${encodeURIComponent(pedidoId)}&pago=mp`;
}

export function armarPreferencia(d: DatosPreferencia): Preferencia {
  const retorno = urlRetorno(d.origen, d.pedidoId);
  const webhook = urlNotificacion(d.origen);
  const cuotas = cuotasPreferencia(d.cuotas);
  return {
    items: [
      {
        id: d.pedidoId,
        title: `Pedido ${d.numero} — Central LED`,
        quantity: 1,
        unit_price: Math.round(d.total * 100) / 100,
        currency_id: "ARS",
      },
    ],
    // Misma referencia que el pago con tarjeta: el webhook rescata el pedido por ella.
    external_reference: d.pedidoId,
    purpose: "wallet_purchase",
    payment_methods: {
      installments: cuotas,
      ...(cuotas > 1 ? { default_installments: cuotas } : {}),
      // "Cuotas sin tarjeta" (Crédito de Mercado Pago) no se ofrece.
      excluded_payment_methods: [{ id: "consumer_credits" }],
    },
    ...(d.emailComprador ? { payer: { email: d.emailComprador } } : {}),
    ...(retorno
      ? { back_urls: { success: retorno, pending: retorno, failure: retorno }, auto_return: "approved" as const }
      : {}),
    ...(webhook ? { notification_url: webhook } : {}),
  };
}

/**
 * ¿La vuelta de Mercado Pago (`back_urls`) trae un pago? Mercado Pago agrega `payment_id` y
 * `collection_id` numéricos; si el comprador tocó "Volver a la tienda" sin pagar llegan "null" (o
 * nada) y no hay nada que confirmar.
 */
export function volvioConPagoDeMercadoPago(q: {
  payment_id?: string | string[];
  collection_id?: string | string[];
}): boolean {
  return [q.payment_id, q.collection_id].flat().some((v) => typeof v === "string" && /^\d+$/.test(v));
}
