/**
 * Script de seguridad de Mercado Pago (id de dispositivo para su control de fraude). Sin React, y con el
 * documento inyectable, así se prueba en el entorno node de los tests unitarios.
 *
 * El script deja el id en `window.MP_DEVICE_SESSION_ID` unos segundos después de cargar. Se lee al
 * enviar el pago y viaja al servidor, que lo manda a Mercado Pago en el header `X-meli-session-id`. Es
 * opcional: sin id se cobra igual.
 */

export const URL_SEGURIDAD_MP = "https://www.mercadopago.com/v2/security.js";

interface DocumentoMinimo {
  querySelector(selector: string): unknown;
  createElement(tag: "script"): { src: string; async: boolean; setAttribute(nombre: string, valor: string): void };
  head: { appendChild(nodo: never): unknown };
}

/**
 * Agrega el script una sola vez (nunca en el servidor). Si ya está en la página, porque lo cargó una
 * llamada anterior o el propio SDK de Mercado Pago, no lo duplica. Devuelve si lo agregó.
 */
export function cargarSeguridadMP(
  doc: DocumentoMinimo | undefined = typeof document === "undefined" ? undefined : (document as unknown as DocumentoMinimo),
): boolean {
  if (!doc) return false;
  if (doc.querySelector('script[src*="mercadopago.com/v2/security.js"]')) return false;
  const script = doc.createElement("script");
  script.src = URL_SEGURIDAD_MP;
  script.async = true;
  // Mercado Pago pide indicar la pantalla: ésta es la del pago.
  script.setAttribute("view", "checkout");
  doc.head.appendChild(script as never);
  return true;
}

/** El id de dispositivo, si el script ya lo generó. El servidor lo vuelve a sanear. */
export function deviceIdMP(
  win: unknown = typeof window === "undefined" ? undefined : window,
): string | undefined {
  const id = (win as { MP_DEVICE_SESSION_ID?: unknown } | undefined)?.MP_DEVICE_SESSION_ID;
  return typeof id === "string" && id ? id : undefined;
}
