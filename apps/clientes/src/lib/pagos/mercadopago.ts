/**
 * Proveedor Mercado Pago. SOLO servidor: acá vive el Access Token.
 *
 * Implementa `ProveedorPago` contra la **Orders API** (`POST /v1/orders`), que
 * acepta el token que genera Checkout Bricks. No se usa `/v1/payments`: MP la
 * marca como *legacy* en su propio panel. Ver §10 de docs/pagos-mercadopago.md.
 *
 * La lógica que se puede testear sin red NO está acá a propósito: la traducción
 * de estados vive en `mercadopago-estados.ts` y la validación de firma en
 * `mercadopago-firma.ts`. Este archivo es el plomería: armar el request,
 * mandarlo, y delegar la interpretación.
 */

import type {
  DatosPago,
  EstadoPago,
  ProveedorPago,
} from "./tipos";
import {
  desafio3DS,
  detalleEfectivo,
  estadoDeMercadoPago,
  motivoDeMercadoPago,
  statusEfectivo,
  type RespuestaMercadoPago,
} from "./mercadopago-estados";
import { firmaValida } from "./mercadopago-firma";

const API = "https://api.mercadopago.com/v1/orders";
const TIMEOUT_MS = 15_000;

function accessToken(): string {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    // Falla ruidoso: sin token no hay cobro posible, y seguir devolvería un
    // "pendiente" que nadie va a resolver nunca.
    throw new Error("Falta MP_ACCESS_TOKEN en el entorno.");
  }
  return token;
}

/**
 * Traduce la respuesta cruda de MP a nuestro vocabulario. Un solo lugar, así
 * `crearPago` y `consultarPago` no pueden divergir.
 */
function interpretar(orden: RespuestaMercadoPago): EstadoPago {
  const status = statusEfectivo(orden);
  const detalle = detalleEfectivo(orden) ?? "";
  return {
    estado: estadoDeMercadoPago(status),
    // La referencia es el id de la ORDEN: es lo que MP manda en el webhook y
    // con lo que después se vuelve a consultar.
    referencia: String(orden.id ?? ""),
    detalle,
    motivo: motivoDeMercadoPago(status, detalle || undefined),
    desafio: desafio3DS(orden),
  };
}

async function pedir(
  url: string,
  init: RequestInit & { idempotencyKey?: string },
): Promise<RespuestaMercadoPago> {
  const { idempotencyKey, ...resto } = init;

  const res = await fetch(url, {
    ...resto,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
      // Sin esto, un reintento sobre un POST que ya llegó cobra dos veces.
      ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      ...(resto.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const cuerpo = (await res.json().catch(() => ({}))) as RespuestaMercadoPago & {
    message?: string;
    cause?: unknown;
  };

  if (!res.ok) {
    // El detalle va al log, nunca al comprador: los mensajes de MP filtran
    // información de la cuenta y del antifraude.
    console.error(`[mercadopago] ${res.status}:`, cuerpo?.message ?? cuerpo, cuerpo?.cause);
    throw new Error(`Mercado Pago respondió ${res.status}`);
  }

  return cuerpo;
}

export const mercadoPago: ProveedorPago = {
  id: "mercadopago",

  /**
   * Crea el pago. El `monto` YA viene del pedido persistido — quien llama es
   * responsable de no tomarlo del browser (ver §2 del doc).
   */
  async crearPago(datos: DatosPago): Promise<EstadoPago> {
    /**
     * Los montos de la Orders API van como STRING con dos decimales, no como
     * número. Mandarlos como número es de los errores que devuelven un 400
     * genérico y cuestan una tarde.
     */
    const monto = datos.monto.toFixed(2);

    const metodo: Record<string, unknown> =
      datos.medio === "cuenta_mp"
        ? { type: "account_money" }
        : {
            type: "credit_card",
            token: datos.token,
            installments: datos.cuotas ?? 1,
            ...(datos.metodoPagoId ? { id: datos.metodoPagoId } : {}),
          };

    const cuerpo: Record<string, unknown> = {
      type: "online",
      processing_mode: "automatic",
      total_amount: monto,
      description: datos.descripcion,
      // Referencia nuestra: permite reconciliar una orden con su pedido sin
      // depender de que MP nos devuelva la metadata.
      external_reference: datos.pedidoId,
      transactions: { payments: [{ amount: monto, payment_method: metodo }] },
    };

    if (datos.emailComprador || datos.numeroDocumento) {
      cuerpo.payer = {
        ...(datos.emailComprador ? { email: datos.emailComprador } : {}),
        ...(datos.tipoDocumento && datos.numeroDocumento
          ? {
              identification: {
                type: datos.tipoDocumento,
                number: datos.numeroDocumento,
              },
            }
          : {}),
      };
    }

    return interpretar(
      await pedir(API, {
        method: "POST",
        body: JSON.stringify(cuerpo),
        // Derivada del pedido: dos envíos del mismo intento son un solo cobro.
        idempotencyKey: `pedido-${datos.pedidoId}`,
      }),
    );
  },

  /**
   * Relee el estado real desde MP. Es lo que usa el webhook: el payload de la
   * notificación solo dice QUÉ id mirar, nunca en qué estado está.
   */
  async consultarPago(referencia: string): Promise<EstadoPago> {
    return interpretar(await pedir(`${API}/${encodeURIComponent(referencia)}`, {
      method: "GET",
    }));
  },

  /**
   * Valida la firma y devuelve el id a consultar.
   *
   * `data.id` se busca primero en la query —que es de donde MP lo toma para
   * firmar— y recién después en el cuerpo. Firmar contra el del cuerpo haría
   * que la validación falle contra las notificaciones reales.
   *
   * El topic que nos interesa es `order`, que es el de la API que usamos. El
   * handler igual ignora con 200 lo que no reconoce: MP manda eventos a los que
   * uno no se suscribió, y devolver error haría que reintente para siempre.
   */
  async verificarWebhook(req: Request, cuerpo: string) {
    const url = new URL(req.url);
    let dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");

    if (!dataId && cuerpo) {
      try {
        const json = JSON.parse(cuerpo) as { data?: { id?: unknown }; id?: unknown };
        const crudo = json?.data?.id ?? json?.id;
        if (crudo != null) dataId = String(crudo);
      } catch {
        // Cuerpo ilegible: se cae por falta de data.id más abajo.
      }
    }

    const resultado = firmaValida({
      signature: req.headers.get("x-signature"),
      requestId: req.headers.get("x-request-id"),
      dataId,
      secreto: process.env.MP_WEBHOOK_SECRET ?? "",
    });

    if (!resultado.valido) {
      // El motivo se loguea pero NO se le responde a quien llama: decirle si
      // falló el timestamp o el HMAC le sirve para ajustar el intento.
      console.error("[mercadopago] webhook rechazado:", resultado.motivo);
      return { valido: false };
    }

    return { valido: true, referencia: dataId ?? undefined };
  },
};
