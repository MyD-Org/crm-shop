/**
 * Proveedor Mercado Pago. SOLO servidor: acá vive el Access Token.
 *
 * Implementa `ProveedorPago` contra `/v1/payments`, que es la API que documenta
 * Checkout Bricks (ver §10 de docs/pagos-mercadopago.md para por qué no la
 * Orders API).
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
  estadoDeMercadoPago,
  motivoDeMercadoPago,
  type RespuestaMercadoPago,
} from "./mercadopago-estados";
import { firmaValida } from "./mercadopago-firma";

const API = "https://api.mercadopago.com/v1/payments";
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
function interpretar(pago: RespuestaMercadoPago): EstadoPago {
  const detalle = pago.status_detail ?? "";
  return {
    estado: estadoDeMercadoPago(pago.status),
    referencia: String(pago.id ?? ""),
    detalle,
    motivo: motivoDeMercadoPago(pago.status, pago.status_detail),
    desafio: desafio3DS(pago),
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
    const cuerpo: Record<string, unknown> = {
      transaction_amount: datos.monto,
      description: datos.descripcion,
      // Referencia nuestra: es lo que permite reconciliar un pago con su pedido
      // sin depender de que MP nos devuelva metadata.
      external_reference: datos.pedidoId,
      metadata: { pedido_id: datos.pedidoId },
      /**
       * Habilita 3D Secure. `optional` y no `mandatory`: con `mandatory`, las
       * tarjetas que no soportan 3DS se rechazan en vez de intentarse. El
       * desafío sube la tasa de aprobación porque el banco tiene más señales.
       */
      three_d_secure_mode: "optional",
    };

    if (datos.medio === "cuenta_mp") {
      cuerpo.payment_method_id = "account_money";
    } else {
      cuerpo.token = datos.token;
      cuerpo.installments = datos.cuotas ?? 1;
      if (datos.metodoPagoId) cuerpo.payment_method_id = datos.metodoPagoId;
    }

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
   * Tolera los dos topics: MP está unificando las notificaciones hacia `order`,
   * y no queremos que la migración nos rompa el webhook en silencio.
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
