/**
 * Lado navegador del cambio de cuenta de cobro. Módulo puro.
 *
 * Cuando el procesador rechaza las credenciales de la cuenta con la que se iba a cobrar (`409
 * cuenta_rechazada`) o la cuenta con la que se tokenizó ya no es la vigente (`409 cuenta_no_valida`), el
 * servidor manda la config pública de la cuenta que corresponde. El formulario se vuelve a armar con ESA
 * key y el comprador vuelve a cargar la tarjeta: el token anterior estaba atado a la otra cuenta.
 */

/** Lo que el servidor manda para volver a armar el formulario (ver `ConfigPublicaCobro`). */
export interface ConfigCuentaCobro {
  cuenta: string;
  publicKey: string;
  baseUrl?: string;
}

export const MENSAJE_REINGRESO_TARJETA =
  "Hubo un inconveniente técnico con el medio de pago. Vuelva a ingresar los datos de su tarjeta e inténtelo nuevamente.";

const MENSAJE_CONFIG_CAMBIO =
  "La configuración del pago cambió. Vuelva a ingresar los datos de su tarjeta e inténtelo nuevamente.";

const textoNoVacio = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Config de la cuenta con la que reintentar, y el mensaje a mostrar, si la respuesta del cobro es un
 * cambio de cuenta. null para cualquier otra respuesta (un rechazo del pago NUNCA cambia la key).
 */
export function cambioDeCuenta(json: unknown): { config: ConfigCuentaCobro; mensaje: string } | null {
  if (!json || typeof json !== "object") return null;
  const r = json as { motivo?: unknown; error?: unknown; config?: unknown };
  if (r.motivo !== "cuenta_rechazada" && r.motivo !== "cuenta_no_valida") return null;
  const c = r.config as { cuenta?: unknown; publicKey?: unknown; baseUrl?: unknown } | undefined;
  if (!c || !textoNoVacio(c.cuenta) || !textoNoVacio(c.publicKey)) return null;
  return {
    config: { cuenta: c.cuenta, publicKey: c.publicKey, ...(textoNoVacio(c.baseUrl) ? { baseUrl: c.baseUrl } : {}) },
    mensaje:
      r.motivo === "cuenta_rechazada"
        ? MENSAJE_REINGRESO_TARJETA
        : textoNoVacio(r.error)
          ? r.error
          : MENSAJE_CONFIG_CAMBIO,
  };
}
