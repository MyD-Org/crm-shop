/**
 * Tokenización de la tarjeta en el NAVEGADOR (modelo "NO PCI" de Payway).
 *
 * El número y el código de seguridad viajan directo del navegador a Payway (`POST /api/v2/tokens`,
 * con la API key PÚBLICA) y vuelve un token de un solo uso (vale ~15 minutos). Nuestro servidor
 * recibe sólo el token y el BIN; los datos de la tarjeta nunca pasan por él.
 *
 * Módulo sin dependencias de React ni del servidor: lo importa el componente del navegador.
 *
 * RIESGO DE CORS: la documentación de Payway no dice que /tokens acepte llamadas desde un navegador
 * de otro origen. Si no las acepta, `fetch` rechaza (TypeError) y acá se ve igual que una caída de
 * red: devuelve `motivo: "red"`, el comprador ve "Revise su conexión… no se realizó ningún cobro" y
 * NO se cobra nada (el token es lo que habilita el cobro y no se obtuvo). Hay que probarlo con las
 * keys de sandbox desde el dominio del Preview; si falla ahí, hay que pedirle a Payway que habilite
 * CORS para el dominio del Shop o indique el mecanismo alternativo.
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
