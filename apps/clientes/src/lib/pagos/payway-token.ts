/**
 * Tokenización de la tarjeta en el NAVEGADOR (modelo "NO PCI" de Payway).
 *
 * El número y el código de seguridad viajan directo del navegador a Payway (`POST /api/v2/tokens`,
 * con la API key PÚBLICA) y vuelve un token de un solo uso (vale ~15 minutos). Nuestro servidor
 * recibe sólo el token y el BIN; los datos de la tarjeta nunca pasan por él.
 *
 * Módulo sin dependencias de React ni del servidor: lo importa el componente del navegador.
 *
 * Camino principal: el SDK JavaScript OFICIAL de Payway (`decidir.js`, repo payway-ar/
 * sdk-javascript-ventaonline), cargado sólo en el checkout desde el host de Payway. Evita el riesgo de
 * CORS (Payway lo sirve y lo conoce). Respaldo: `fetch` directo a `/tokens`, por si el script no carga.
 *
 * RIESGO DE CORS (sólo en el respaldo): la documentación de la API no dice que /tokens acepte
 * llamadas desde un navegador de otro origen. Si no las acepta, `fetch` rechaza (TypeError) y se ve
 * igual que una caída de red: `motivo: "red"`, el comprador ve "no se realizó ningún cobro" y NO se
 * cobra nada (sin token no hay cobro). Probar con las keys de sandbox desde el dominio del Preview.
 *
 * Cybersource (huella del dispositivo) del SDK: DESACTIVADO (`INHABILITAR_CYBERSOURCE`). El adaptador
 * del servidor no manda `fraud_detection` y no está confirmado que el site tenga antifraude activo;
 * encenderlo sin reenviar el identificador sólo sumaría scripts de terceros. Ver el reporte.
 *
 * NUNCA se loguea el cuerpo del request, el de la respuesta ni la key: sólo el estado HTTP.
 */

import type { SolicitudToken } from "./payway-tarjeta";

export type MotivoToken = "datos_invalidos" | "configuracion" | "red";

/** Textos al comprador, en usted. */
export const MENSAJE_TOKEN: Record<MotivoToken, string> = {
  datos_invalidos: "Revise el número, la fecha de vencimiento y el código de seguridad.",
  configuracion: "No pudimos procesar el pago. Inténtelo de nuevo o elija transferencia.",
  red: "No pudimos comunicarnos con el procesador de pagos; no se realizó ningún cobro. Revise su conexión e inténtelo de nuevo.",
};

export type ResultadoToken =
  | { ok: true; token: string; bin: string }
  | { ok: false; motivo: MotivoToken; mensaje: string };

export interface ConfigPayway {
  /** Host de la API (https), con o sin `/api/v2`. */
  baseUrl: string;
  /** API key PÚBLICA (sólo sirve para tokenizar). */
  publicKey: string;
}

interface Deps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const TIMEOUT_MS = 15_000;

/** Script oficial del SDK de front de Payway (versión fijada). Sólo se carga en el checkout. */
export const URL_SDK_PAYWAY = "https://ventasonline.payway.com.ar/static/v2.6.4/decidir.js";
/** Ver el comentario del módulo: sin huella de dispositivo hasta confirmar el antifraude con Payway. */
const INHABILITAR_CYBERSOURCE = true;

const falla = (motivo: MotivoToken): ResultadoToken => ({ ok: false, motivo, mensaje: MENSAJE_TOKEN[motivo] });

/** `https://host[/ruta]` sin barra final ni `/api/v2`; null si no es https. */
function base(crudo: string): string | null {
  try {
    const u = new URL(crudo);
    if (u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "").replace(/\/api\/v2$/, "")}`;
  } catch {
    return null;
  }
}

export async function tokenizarTarjeta(
  solicitud: SolicitudToken,
  config: ConfigPayway,
  deps: Deps = {},
): Promise<ResultadoToken> {
  const raiz = base(config.baseUrl);
  if (!raiz || !config.publicKey) {
    console.error("[payway] tokenización sin configuración válida (URL base o key pública).");
    return falla("configuracion");
  }

  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`${raiz}/api/v2/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.publicKey },
      body: JSON.stringify(solicitud),
      // Es otro origen: sin cookies de nuestro sitio.
      credentials: "omit",
      signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (err) {
    // Sin el mensaje de la causa. Una falla de CORS y una caída de red son indistinguibles acá.
    console.error("[payway] la tokenización no obtuvo respuesta:", (err as Error)?.name ?? "error");
    return falla("red");
  }

  if (res.status === 400) return falla("datos_invalidos");
  if (res.status === 401 || res.status === 403) {
    console.error(`[payway] la tokenización respondió ${res.status}: revisar la key pública y las habilitaciones.`);
    return falla("configuracion");
  }
  if (res.status !== 201 && res.status !== 200) {
    console.error(`[payway] la tokenización respondió ${res.status}.`);
    return falla("red");
  }

  const cuerpo = (await res.json().catch(() => null)) as { id?: unknown; bin?: unknown } | null;
  if (!cuerpo || typeof cuerpo.id !== "string" || !cuerpo.id || typeof cuerpo.bin !== "string" || !/^\d{6}$/.test(cuerpo.bin)) {
    console.error("[payway] la tokenización respondió con un cuerpo inesperado.");
    return falla("configuracion");
  }
  return { ok: true, token: cuerpo.id, bin: cuerpo.bin };
}


/* ───────────────────────── SDK oficial (decidir.js) ───────────────────────── */

/** Lo que usamos de la clase `Decidir` del SDK oficial. */
export interface SdkDecidir {
  setPublishableKey(key: string): void;
  setTimeout(ms: number): void;
  createToken(form: unknown, callback: (status: number, respuesta: unknown) => void): void;
  getBin?(pan: string): string;
}
export type ConstructorDecidir = new (url: string, inhabilitarCybersource?: boolean) => SdkDecidir;

/** Lo que necesita del navegador (se inyecta para poder probar sin DOM). */
export interface EntornoSdk {
  /** Carga el script (una vez). null si no pudo (bloqueado, sin red). */
  cargarSdk(): Promise<ConstructorDecidir | null>;
  /**
   * Arma un formulario efímero con los campos `data-decidir` que lee el SDK. Los datos de la tarjeta
   * viven ahí sólo hasta que `desmontar()` lo saca del documento.
   */
  montarFormulario(campos: Record<string, string>): { form: unknown; desmontar(): void };
}

/** Campos `data-decidir` del SDK a partir de la solicitud ya normalizada. */
export function camposSdk(s: SolicitudToken): Record<string, string> {
  return {
    card_number: s.card_number,
    security_code: s.security_code,
    card_holder_name: s.card_holder_name,
    card_expiration_month: s.card_expiration_month,
    card_expiration_year: s.card_expiration_year,
    card_holder_doc_type: s.card_holder_identification.type,
    card_holder_doc_number: s.card_holder_identification.number,
  };
}

/**
 * Tokeniza con el SDK oficial. null = el SDK no se pudo cargar (el llamador puede probar el respaldo).
 * Cualquier otro resultado es definitivo.
 */
export async function tokenizarConSdk(
  solicitud: SolicitudToken,
  config: ConfigPayway,
  entorno: EntornoSdk,
): Promise<ResultadoToken | null> {
  const raiz = base(config.baseUrl);
  if (!raiz || !config.publicKey) {
    console.error("[payway] tokenización sin configuración válida (URL base o key pública).");
    return falla("configuracion");
  }
  const Decidir = await entorno.cargarSdk();
  if (!Decidir) return null;

  const montado = entorno.montarFormulario(camposSdk(solicitud));
  try {
    const decidir = new Decidir(`${raiz}/api/v2`, INHABILITAR_CYBERSOURCE);
    decidir.setPublishableKey(config.publicKey);
    decidir.setTimeout(TIMEOUT_MS);

    const [status, respuesta] = await new Promise<[number, unknown]>((resolver) => {
      try {
        decidir.createToken(montado.form, (st, r) => resolver([st, r]));
      } catch (err) {
        console.error("[payway] el SDK de tokenización falló:", (err as Error)?.name ?? "error");
        resolver([0, null]);
      }
    });

    const r = (respuesta ?? {}) as { id?: unknown; token?: unknown; bin?: unknown; error?: unknown };
    if (status === 200 || status === 201) {
      const id = typeof r.id === "string" && r.id ? r.id : typeof r.token === "string" && r.token ? r.token : "";
      const bin =
        typeof r.bin === "string" && /^\d{6}$/.test(r.bin) ? r.bin : (decidir.getBin?.(solicitud.card_number) ?? "");
      if (!id || !/^\d{6}$/.test(bin)) {
        console.error("[payway] el SDK respondió sin token o sin BIN utilizable.");
        return falla("configuracion");
      }
      return { ok: true, token: id, bin };
    }
    // Validaciones propias del SDK (número, vencimiento, titular): llegan como `error: [...]`.
    if (status === 400 || Array.isArray(r.error)) return falla("datos_invalidos");
    if (status === 401 || status === 403) {
      console.error(`[payway] el SDK respondió ${status}: revisar la key pública y las habilitaciones.`);
      return falla("configuracion");
    }
    console.error(`[payway] el SDK respondió ${status}.`);
    return falla("red");
  } finally {
    montado.desmontar();
  }
}

/** SDK oficial primero; si no está disponible, `fetch` directo a `/tokens`. */
export async function tokenizar(
  solicitud: SolicitudToken,
  config: ConfigPayway,
  deps: Deps & { entorno?: EntornoSdk } = {},
): Promise<ResultadoToken> {
  if (deps.entorno) {
    const r = await tokenizarConSdk(solicitud, config, deps.entorno);
    if (r) return r;
    console.error("[payway] el SDK no cargó; se tokeniza con la API directa.");
  }
  return tokenizarTarjeta(solicitud, config, deps);
}
