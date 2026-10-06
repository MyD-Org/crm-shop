/**
 * Proveedor Payway (ex Decidir), modelo "NO PCI". SOLO servidor: acá vive la API Key privada.
 *
 * El navegador tokeniza la tarjeta contra Payway con la key PÚBLICA y a nosotros sólo nos llega un
 * token; acá se cobra con `POST /payments`. Lo que dice la documentación oficial y condiciona todo:
 *
 * - `amount` va en CENTAVOS enteros.
 * - El id con el que reconocemos un pago es el `site_transaction_id` que mandamos nosotros (el id del
 *   intento sin guiones), no el `payment_id` numérico. Se conoce antes de llamar, y eso permite
 *   recuperarse de un timeout consultando por `siteOperationId`.
 * - Un rechazo es HTTP 402 con el cuerpo de un pago: se parsea, no es un error de red.
 * - Sin respuesta (timeout, 5xx, red) el pago pudo crearse igual: se CONSULTA antes de hacer cualquier
 *   otra cosa y el POST nunca se reintenta (doble cobro).
 * - No hay webhooks documentados: la red de seguridad es el cron de conciliación (`consultarPago`).
 * - No existe un pago "abierto" que se pueda cancelar: anular o devolver es `POST /refunds`, y eso lo
 *   hace una persona. `cancelarPago` sólo consulta.
 *
 * La traducción de estados, motivos y montos vive en `payway-estados.ts` (puro). Acá está la
 * plomería HTTP. La fábrica `crearPayway` recibe `fetch` y la pausa para poder probarlo sin red.
 */

import {
  ErrorProveedor,
  type DatosPago,
  type EstadoPago,
  type ProveedorPago,
} from "./tipos";
import { armarFraudDetection } from "./payway-antifraude";
import {
  centavos,
  esDebito,
  idsMedioPermitidos,
  interpretarPago,
  referenciaDeIntento,
  type RespuestaPayway,
} from "./payway-estados";

/**
 * `POST /payments`: con el control de fraude (Cybersource) activo el sandbox llegó a tardar más de
 * 15 s en responder (y después igual resolvió el pago), así que se espera hasta 30 s. La ruta de cobro
 * declara `maxDuration` de sobra para el peor caso (ver `app/api/pagos/[proveedor]/route.ts`).
 */
const TIMEOUT_PAGO_MS = 30_000;
/** Consultas (GET): rápidas. */
const TIMEOUT_CONSULTA_MS = 15_000;
/** Consultas para recuperarse de un timeout, con una pausa entre una y otra. */
const CONSULTAS_TRAS_TIMEOUT = 3;
const PAUSA_MS = 3_000;

/** Base de la API (sin barra final ni `/api/v2`), o null si falta o no es https. */
function baseUrl(): string | null {
  const crudo = process.env.PAYWAY_BASE_URL?.trim();
  if (!crudo) return null;
  let url: URL;
  try {
    url = new URL(crudo);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/api\/v2$/, "")}`;
}

/**
 * ¿Hay credenciales para cobrar? Key privada (servidor), key pública (el formulario del navegador) y
 * la URL base de la API. Sin alguna, el medio `payway` no se ofrece ni se acepta aunque esté activo.
 */
export function paywayConfigurado(): boolean {
  return (
    Boolean(process.env.PAYWAY_API_PRIVATE_KEY) && Boolean(process.env.PAYWAY_API_PUBLIC_KEY) && baseUrl() !== null
  );
}

/**
 * Lo que el navegador necesita para tokenizar la tarjeta: la key PÚBLICA (sirve sólo para
 * `POST /tokens`) y la base de la API. Sale del servidor en runtime, así no hace falta una variable
 * `NEXT_PUBLIC_*` aparte (que además se hornea en el build). null si el medio no está configurado.
 * La key privada NUNCA sale de acá.
 */
export function paywayConfigPublica(): { publicKey: string; baseUrl: string } | null {
  const baseUrlOk = baseUrl();
  const publicKey = process.env.PAYWAY_API_PUBLIC_KEY?.trim();
  if (!paywayConfigurado() || !baseUrlOk || !publicKey) return null;
  return { publicKey, baseUrl: baseUrlOk };
}

interface Deps {
  fetch?: typeof fetch;
  pausa?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

interface Respuesta {
  status: number;
  cuerpo: unknown;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const sinPago = (mensaje: string) => new ErrorProveedor(mensaje, 400);

export function crearPayway(deps: Deps = {}): ProveedorPago & { requiereBin: true; requiereAntifraude: true } {
  // Se resuelve en cada llamada: así un `fetch` global reemplazado después (tests) también se respeta.
  const doFetch: typeof fetch = (...a) => (deps.fetch ?? fetch)(...a);
  const pausa = deps.pausa ?? dormir;
  const timeoutPago = deps.timeoutMs ?? TIMEOUT_PAGO_MS;
  const timeoutConsulta = deps.timeoutMs ?? TIMEOUT_CONSULTA_MS;

  /** Request a la API. Tira `ErrorProveedor(504)` si no hay respuesta (timeout o red). */
  async function pedir(ruta: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<Respuesta> {
    const base = baseUrl();
    const key = process.env.PAYWAY_API_PRIVATE_KEY;
    if (!base || !key) throw new Error("Falta la configuración de Payway (PAYWAY_API_PRIVATE_KEY, PAYWAY_BASE_URL).");

    let res: Response;
    try {
      res = await doFetch(`${base}/api/v2${ruta}`, {
        method: init.method,
        headers: { "Content-Type": "application/json", apikey: key },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(init.method === "POST" ? timeoutPago : timeoutConsulta),
      });
    } catch (err) {
      // Sin el mensaje de la causa: a veces trae la URL o headers.
      console.error(`[payway] sin respuesta (${init.method} ${ruta.split("?")[0]}):`, (err as Error)?.name ?? "error");
      throw new ErrorProveedor("Payway no respondió", 504);
    }
    const cuerpo = await res.json().catch(() => null);
    return { status: res.status, cuerpo };
  }

  /**
   * Log de un error HTTP: sólo status y tipo de error. El cuerpo del request lleva el token de la
   * tarjeta y el de la respuesta datos de la cuenta, y la key viaja en un header: nada de eso se loguea.
   */
  function errorHttp(r: Respuesta, donde: string): ErrorProveedor {
    const c = (r.cuerpo ?? {}) as { error_type?: string; message?: string };
    console.error(`[payway] ${donde} respondió ${r.status}`, c.error_type ?? c.message ?? "");
    if (r.status === 401 || r.status === 403) {
      console.error("[payway] error de credenciales o de habilitación del site: revisar las keys y las habilitaciones.");
    }
    return new ErrorProveedor(`Payway respondió ${r.status}`, r.status);
  }

  /** Pago de esa referencia, o null si Payway no lo conoce. */
  async function buscar(referencia: string): Promise<EstadoPago | null> {
    const r = await pedir(`/payments?siteOperationId=${encodeURIComponent(referencia)}`, { method: "GET" });
    if (r.status === 404) return null;
    if (r.status !== 200) throw errorHttp(r, "consulta");

    const cuerpo = r.cuerpo as { results?: RespuestaPayway[] } | null;
    const resultados = Array.isArray(cuerpo?.results) ? cuerpo.results : [];
    const pago = resultados.find((p) => p.site_transaction_id === referencia) ?? resultados[0];
    return pago ? { ...interpretarPago(pago), referencia: pago.site_transaction_id || referencia } : null;
  }

  const noEncontrado = (referencia: string): EstadoPago => ({
    estado: "pendiente",
    referencia,
    detalle: "no_encontrado",
    noEncontrado: true,
  });

  /**
   * El POST no tuvo una respuesta utilizable: el pago pudo haberse creado. Se consulta (nunca se
   * reintenta el POST). Si no se puede saber, queda `pendiente` con la referencia, y el cron de
   * conciliación lo resuelve.
   */
  async function recuperar(referencia: string): Promise<EstadoPago> {
    for (let i = 0; i < CONSULTAS_TRAS_TIMEOUT; i++) {
      if (i > 0) await pausa(PAUSA_MS);
      try {
        const encontrado = await buscar(referencia);
        if (encontrado) return encontrado;
      } catch {
        // Ya se logueó adentro. Se sigue: lo peor que pasa es quedar pendiente.
      }
    }
    return { estado: "pendiente", referencia, detalle: "sin_respuesta_de_payway" };
  }

  /** Valida lo que Payway rechazaría de todos modos: falla antes de la red, seguro sin pago. */
  function armarCuerpo(datos: DatosPago, referencia: string): Record<string, unknown> {
    if (datos.medio !== "tarjeta") throw sinPago("Payway sólo cobra con tarjeta.");
    if (!datos.token) throw sinPago("Falta el token de la tarjeta.");
    if (!datos.bin || !/^\d{6}$/.test(datos.bin)) throw sinPago("Falta el BIN de la tarjeta.");

    const metodo = Number(datos.metodoPagoId);
    if (!datos.metodoPagoId || !Number.isInteger(metodo) || !idsMedioPermitidos().has(metodo)) {
      throw sinPago("Medio de pago de tarjeta inválido.");
    }
    const cuotas = datos.cuotas ?? 1;
    if (!Number.isInteger(cuotas) || cuotas < 1 || cuotas > 99) throw sinPago("Cantidad de cuotas inválida.");
    // El débito no admite cuotas.
    if (esDebito(metodo) && cuotas !== 1) throw sinPago("El débito no admite cuotas.");

    let amount: number;
    try {
      amount = centavos(datos.monto);
    } catch {
      throw sinPago("Monto inválido.");
    }

    // Control de fraude (Cybersource): sólo si la ruta de cobro armó los datos del pedido.
    let fraud_detection: unknown;
    if (datos.antifraude) {
      try {
        fraud_detection = armarFraudDetection(datos.antifraude, datos.monto);
      } catch (err) {
        // Sin el detalle de los datos del comprador: sólo qué faltó.
        throw sinPago(err instanceof Error ? err.message : "Datos de control de fraude inválidos.");
      }
    }

    return {
      bin: datos.bin,
      token: datos.token,
      amount,
      currency: "ARS",
      description: datos.descripcion.slice(0, 255),
      installments: cuotas,
      payment_type: "single",
      sub_payments: [],
      payment_method_id: metodo,
      site_transaction_id: referencia,
      ...(fraud_detection ? { fraud_detection } : {}),
    };
  }

  return {
    id: "payway",
    requiereBin: true,
    requiereAntifraude: true,
    configurado: paywayConfigurado,
    referenciaDeIntento,

    async crearPago(datos: DatosPago): Promise<EstadoPago> {
      if (!datos.intentoId) throw sinPago("Falta el intento de cobro.");
      let referencia: string;
      try {
        referencia = referenciaDeIntento(datos.intentoId);
      } catch {
        throw sinPago("El intento no sirve como identificador de la operación.");
      }
      const cuerpo = armarCuerpo(datos, referencia);

      let r: Respuesta;
      try {
        r = await pedir("/payments", { method: "POST", body: cuerpo });
      } catch (err) {
        if (err instanceof ErrorProveedor && err.status === 504) return recuperar(referencia);
        throw err;
      }

      // 201 aprobado, o 402 rechazado: los dos traen el cuerpo del pago.
      if (r.status === 201 || r.status === 200 || r.status === 402) {
        const pago = r.cuerpo as RespuestaPayway | null;
        if (pago && typeof pago === "object") {
          const conStatus = r.status === 402 && !pago.status ? { ...pago, status: "rejected" } : pago;
          if (conStatus.status) {
            return { ...interpretarPago(conStatus), referencia: conStatus.site_transaction_id || referencia };
          }
        }
        // Respuesta exitosa pero ilegible: el pago pudo crearse. Se consulta.
        console.error(`[payway] respuesta ${r.status} sin estado de pago`);
        return recuperar(referencia);
      }

      if (r.status >= 500) {
        console.error(`[payway] /payments respondió ${r.status}`);
        return recuperar(referencia);
      }

      // 400, 401, 403, 404 y demás 4xx: Payway rechazó el request, seguro que no hay pago.
      throw errorHttp(r, "/payments");
    },

    async consultarPago(referencia: string): Promise<EstadoPago> {
      return (await buscar(referencia)) ?? noEncontrado(referencia);
    },

    /**
     * En Payway no hay un pago "abierto" que se pueda cancelar: anular o devolver es un reembolso,
     * y devolver plata es una decisión de una persona (el backoffice de Payway), nunca automática.
     * Quien llama (`resolverIntentoAbierto`) usa el estado real para decidir si libera el pedido.
     */
    async cancelarPago(referencia: string): Promise<EstadoPago> {
      return (await buscar(referencia)) ?? noEncontrado(referencia);
    },
  };
}

export const payway = crearPayway();
