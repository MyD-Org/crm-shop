/**
 * Proveedor Mercado Pago. SOLO servidor: acá vive el Access Token.
 *
 * Implementa `ProveedorPago` contra la **Payments API** (`POST /v1/payments`).
 * La Orders API sería el camino "moderno" según el panel de MP, pero rechaza
 * credenciales TEST- con `"Test credentials are not supported"` — y hasta que
 * Fede complete la homologación para tener credenciales de producción, es la
 * única forma de probar. Payments API está marcada como legacy pero no está
 * deprecada y es lo que la mayoría de integraciones usan. Volver a Orders es
 * cambiar este archivo cuando llegue el momento; el vocabulario nuestro no
 * depende del endpoint.
 *
 * La lógica que se puede testear sin red NO está acá a propósito: la traducción
 * de estados vive en `mercadopago-estados.ts` y la validación de firma en
 * `mercadopago-firma.ts`. Este archivo es el plomería: armar el request,
 * mandarlo, y delegar la interpretación.
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  DatosPago,
  EstadoPago,
  ProveedorPago,
} from "./tipos";
import {
  desafio3DS,
  detalleEfectivo,
  esReversion,
  estadoDeMercadoPago,
  motivoDeMercadoPago,
  statusEfectivo,
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
 * Clave de idempotencia del intento de cobro.
 *
 * Tiene que ser estable dentro de UN intento y distinta entre intentos, y esas
 * dos mitades importan por razones opuestas:
 *
 * - Si cambiara dentro del mismo intento, un reenvío del request cobraría dos
 *   veces.
 * - Si NO cambiara entre intentos, MP devolvería la respuesta cacheada del
 *   primero: un rechazo por fondos quedaría pegado y el reintento con otra
 *   tarjeta recibiría el mismo rechazo para siempre.
 *
 * El token de tarjeta cumple las dos: es de un solo uso y lo genera el brick en
 * cada carga del formulario. Se hashea para no mandar el token dentro de un
 * header además del cuerpo.
 *
 * Para `cuenta_mp` no hay token, así que se usa una clave aleatoria por intento.
 */
export function claveIdempotencia(datos: DatosPago): string {
  const semilla = datos.token
    ? createHash("sha256").update(`${datos.pedidoId}:${datos.token}`).digest("hex").slice(0, 32)
    : randomUUID();
  return `${datos.pedidoId}-${semilla}`;
}

/**
 * Traduce la respuesta cruda de MP a nuestro vocabulario. Un solo lugar, así
 * `crearPago` y `consultarPago` no pueden divergir.
 */
export function interpretar(pago: RespuestaMercadoPago): EstadoPago {
  const status = statusEfectivo(pago);
  const detalle = detalleEfectivo(pago) ?? "";
  return {
    estado: estadoDeMercadoPago(status),
    // La referencia es el id del PAGO: es lo que MP manda en el webhook y con
    // lo que después se vuelve a consultar.
    referencia: String(pago.id ?? ""),
    detalle,
    motivo: motivoDeMercadoPago(status, detalle || undefined),
    /**
     * Se calcula ACÁ, que es el único lugar donde se ve el status crudo de MP.
     * Afuera ya está todo traducido a nuestro vocabulario y la comparación no
     * podría dar nunca — un contracargo se perdería en silencio.
     */
    reversion: esReversion(status),
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
   *
   * A diferencia de Orders API, Payments API acepta el monto como NÚMERO y
   * expone los campos planos en el root. Es lo mismo que hace la mayoría de
   * ejemplos oficiales de MP.
   */
  async crearPago(datos: DatosPago): Promise<EstadoPago> {
    const cuerpo: Record<string, unknown> = {
      transaction_amount: datos.monto,
      description: datos.descripcion,
      // Referencia nuestra: permite reconciliar un pago con su pedido sin
      // depender de que MP nos devuelva la metadata.
      external_reference: datos.pedidoId,
      // Habilita el desafío 3DS: el brick lo renderiza con Status Screen.
      three_d_secure_mode: "optional",
    };

    if (datos.medio === "cuenta_mp") {
      // Dinero en cuenta: MP identifica al comprador por el email del payer, no
      // hace falta token de tarjeta.
      cuerpo.payment_method_id = "account_money";
    } else {
      // Tarjeta: el token viene del brick y es de un solo uso; installments y
      // payment_method_id (marca de la tarjeta) también.
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
        idempotencyKey: claveIdempotencia(datos),
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
   * El topic que nos interesa es `payment`, que es el que emite Payments API.
   * El handler igual ignora con 200 lo que no reconoce: MP manda eventos a los
   * que uno no se suscribió, y devolver error haría que reintente para siempre.
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
