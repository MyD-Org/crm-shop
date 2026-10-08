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
import {
  ErrorProveedor,
  type DatosPago,
  type EstadoPago,
  type ProveedorPago,
} from "./tipos";
import {
  desafio3DS,
  detalleEfectivo,
  esReversion,
  estadoDeMercadoPago,
  infoDeMercadoPago,
  motivoDeMercadoPago,
  statusEfectivo,
  type RespuestaMercadoPago,
} from "./mercadopago-estados";
import { firmaValida } from "./mercadopago-firma";
import type { Preferencia } from "./mercadopago-preferencia";

const API = "https://api.mercadopago.com/v1/payments";
const API_PREFERENCIAS = "https://api.mercadopago.com/checkout/preferences";
const TIMEOUT_MS = 15_000;

/**
 * ¿Hay credenciales para cobrar? Access Token (servidor) y Public Key (el Brick del navegador). Si
 * falta alguna, el medio `mercadopago` no se ofrece ni se acepta aunque esté activo en el CRM.
 */
export function mercadoPagoConfigurado(): boolean {
  return Boolean(process.env.MP_ACCESS_TOKEN) && Boolean(process.env.NEXT_PUBLIC_MP_PUBLIC_KEY);
}

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
/**
 * URL a la que Mercado Pago tiene que avisar los cambios de ESTE pago.
 *
 * Sin `notification_url` en el pago, MP usa la configurada en su panel, y esa
 * depende del MODO de las credenciales, no del entorno: con credenciales TEST-,
 * producción recibía sus notificaciones en la URL de "modo de prueba" (dev). Un
 * pago que quedaba pendiente y se aprobaba después nunca le llegaba a producción.
 *
 * Mandándola en cada pago, cada entorno recibe las suyas.
 *
 * - Solo https y dominio público: MP rechaza el pago entero con 400 si la URL
 *   es localhost, y en local no hay forma de que le llegue igual.
 * - `source_news=webhooks` pide el formato Webhooks (firmado, con x-signature),
 *   no el IPN viejo sin firma que el handler rechazaría.
 */
export function urlNotificacion(origen: string | null | undefined): string | undefined {
  if (!origen) return undefined;
  let url: URL;
  try {
    url = new URL(origen);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return undefined;
  return `${url.origin}/api/pagos/mercadopago/webhook?source_news=webhooks`;
}

export function claveIdempotencia(datos: DatosPago): string {
  const semilla = datos.token
    ? createHash("sha256").update(`${datos.pedidoId}:${datos.token}`).digest("hex").slice(0, 32)
    : randomUUID();
  return `${datos.pedidoId}-${semilla}`;
}

const montoValido = (n: unknown): number | undefined =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;

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
    ...(pago.external_reference ? { pedidoId: String(pago.external_reference) } : {}),
    detalle,
    motivo: motivoDeMercadoPago(status, detalle || undefined),
    /**
     * Se calcula ACÁ, que es el único lugar donde se ve el status crudo de MP.
     * Afuera ya está todo traducido a nuestro vocabulario y la comparación no
     * podría dar nunca — un contracargo se perdería en silencio.
     */
    reversion: esReversion(status),
    desafio: desafio3DS(pago),
    cuotasPagadas:
      Number.isInteger(pago.installments) && (pago.installments as number) >= 1
        ? pago.installments
        : undefined,
    totalPagado: montoValido(pago.transaction_details?.total_paid_amount),
    ...infoDeMercadoPago(pago),
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

    /**
     * Qué campos llevaba el request. Solo los NOMBRES, nunca los valores: acá
     * viajan el token de la tarjeta y el email del comprador.
     *
     * MP responde "Params Error" sin decir qué parámetro falta, y varios campos
     * se mandan solo si existen. Sin esta línea, diagnosticar un 400 es adivinar
     * — que es exactamente lo que costó descubrir que faltaba `payer.email`.
     */
    if (typeof resto.body === "string") {
      try {
        const enviado = JSON.parse(resto.body) as Record<string, unknown>;
        const payer = enviado.payer as Record<string, unknown> | undefined;
        console.error(
          "[mercadopago] campos enviados:",
          Object.keys(enviado).join(", "),
          "| payer:",
          payer ? Object.keys(payer).join(", ") : "AUSENTE",
        );
      } catch {
        // Cuerpo no parseable: el error de arriba ya alcanza.
      }
    }

    throw new ErrorProveedor(`Mercado Pago respondió ${res.status}`, res.status);
  }

  return cuerpo;
}

/**
 * Crea la preferencia con la que el Payment Brick ofrece dinero en cuenta (`initialization.preferenceId`).
 * Devuelve sólo el id: lo demás de la respuesta (init_point, etc.) no se usa ni sale al navegador.
 * Idempotencia: cada llamada es una preferencia nueva e inofensiva (no cobra nada hasta que el comprador
 * paga en Mercado Pago), así que no lleva clave.
 */
/** Crea la preferencia y devuelve la URL de Mercado Pago a la que se lleva al comprador (`init_point`). */
export async function crearPreferencia(preferencia: Preferencia): Promise<string> {
  const r = await pedir(API_PREFERENCIAS, { method: "POST", body: JSON.stringify(preferencia) });
  const initPoint = (r as { init_point?: unknown }).init_point;
  const url = typeof initPoint === "string" ? initPoint : "";
  if (!url) throw new ErrorProveedor("Mercado Pago no devolvió el link de pago de la preferencia", 502);
  return url;
}

/**
 * Desde este total (en pesos, estricto: "más de") la validación del banco (3DS) es OBLIGATORIA. Con 3DS,
 * un contracargo por fraude ("yo no hice esta compra") pasa a ser responsabilidad del banco; en las compras
 * grandes es donde un fraude más duele. Abajo queda opcional: el banco la pide sólo si ve riesgo, así no se
 * pierden ventas de tarjetas o bancos que no la soportan (con `mandatory` esos pagos se rechazan con
 * `cc_rejected_3ds_mandatory`).
 */
export const MONTO_3DS_OBLIGATORIO = 300_000;

export function modo3DS(monto: number): "mandatory" | "optional" {
  return monto > MONTO_3DS_OBLIGATORIO ? "mandatory" : "optional";
}

export const mercadoPago: ProveedorPago = {
  id: "mercadopago",

  configurado: mercadoPagoConfigurado,

  urlNotificacion,

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
      ...(datos.urlNotificacion ? { notification_url: datos.urlNotificacion } : {}),
      // Desafío 3DS (el brick lo renderiza con Status Screen): obligatorio desde un monto, opcional abajo.
      three_d_secure_mode: modo3DS(datos.monto),
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
   * MP solo deja cancelar pagos `pending`, `in_process` o `authorized`. Si el
   * pago ya se resolvió responde 400: quien llama lo trata como "no se pudo" y
   * vuelve a consultar.
   */
  async cancelarPago(referencia: string): Promise<EstadoPago> {
    return interpretar(await pedir(`${API}/${encodeURIComponent(referencia)}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
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
