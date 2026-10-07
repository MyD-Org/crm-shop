/**
 * Preferencia de Mercado Pago para pagar con dinero en cuenta. Módulo PURO: sin red ni secretos.
 *
 * Según la documentación del Payment Brick, la opción `mercadoPago` exige `initialization.preferenceId`
 * (preferencia con `purpose: "wallet_purchase"`): el pago con cuenta no pasa por nuestro
 * `POST /v1/payments` sino por el flujo de Mercado Pago, que vuelve al sitio por `back_urls` y avisa por
 * webhook. Todo sale del pedido congelado, nunca del navegador.
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
}

export interface Preferencia {
  items: { id: string; title: string; quantity: 1; unit_price: number; currency_id: "ARS" }[];
  external_reference: string;
  purpose: "wallet_purchase";
  payment_methods: { installments: 1 };
  payer?: { email: string };
  back_urls?: { success: string; pending: string; failure: string };
  auto_return?: "approved";
  notification_url?: string;
}

/** Dinero en cuenta sólo en un pago: con 2 o más cuotas congeladas el pedido es sólo de tarjeta de crédito. */
export function cuentaMpDisponible(cuotasPedido: number | null | undefined): boolean {
  return cuotasPedido == null || cuotasPedido === 1;
}

/** A dónde vuelve el comprador. Mercado Pago rechaza back_urls que no sean https de dominio público. */
export function urlRetorno(origen: string | null | undefined, pedidoId: string): string | undefined {
  if (!urlNotificacion(origen)) return undefined; // misma regla: https y dominio público
  return `${new URL(origen as string).origin}/checkout?pedido=${encodeURIComponent(pedidoId)}&pago=mp`;
}

export function armarPreferencia(d: DatosPreferencia): Preferencia {
  const retorno = urlRetorno(d.origen, d.pedidoId);
  const webhook = urlNotificacion(d.origen);
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
    payment_methods: { installments: 1 },
    ...(d.emailComprador ? { payer: { email: d.emailComprador } } : {}),
    ...(retorno
      ? { back_urls: { success: retorno, pending: retorno, failure: retorno }, auto_return: "approved" as const }
      : {}),
    ...(webhook ? { notification_url: webhook } : {}),
  };
}
