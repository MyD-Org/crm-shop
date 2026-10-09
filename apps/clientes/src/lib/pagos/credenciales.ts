/**
 * Credenciales de los procesadores de pago: el ÚNICO lugar que las lee del entorno. SOLO servidor.
 *
 * Una cuenta de Mercado Pago y una de Payway por sucursal (cada sucursal tiene su CUIT). La cuenta es el
 * slug de la sucursal y es OBLIGATORIA: no hay "cuenta principal" ni variables sin sufijo. El sufijo de
 * cada variable es el slug en mayúsculas con `-` -> `_` (`slugAVariable`):
 *
 * - Mercado Pago: `MP_ACCESS_TOKEN_<S>` (servidor), `MP_PUBLIC_KEY_<S>` (el Brick del navegador, sale del
 *   servidor por pedido) y `MP_WEBHOOK_SECRET_<S>` (firma de los webhooks de esa cuenta).
 * - Payway: `PAYWAY_API_PRIVATE_KEY_<S>` y `PAYWAY_API_PUBLIC_KEY_<S>`; la base de la API,
 *   `PAYWAY_BASE_URL`, es la única variable compartida.
 *
 * Qué cuenta usa cada pedido lo decide `cuenta-cobro.ts` (puro) con los datos de `cuentas-sucursales.ts`.
 * La guarda de `credenciales.test.ts` impide nombrar estas variables en cualquier otro archivo de `src`.
 *
 * Sin alias `@/` ni dependencias con red o base: lo importa `headers-seguridad.ts`, que corre en
 * next.config.
 */

import { slugAVariable } from "./cuenta-cobro";

/** Variables de entorno (inyectables en los tests). */
export type Entorno = Record<string, string | undefined>;

export interface CredencialesMercadoPago {
  /** La cuenta (slug de la sucursal): logs y cachés por cuenta. */
  cuentaId: string;
  /** Access Token: sólo servidor. */
  accessToken: string | null;
  /** Public Key: la usa el Brick en el navegador. */
  publicKey: string | null;
  /** Clave secreta con la que Mercado Pago firma los webhooks de esta cuenta. */
  webhookSecret: string | null;
}

export interface CredencialesPayway {
  cuentaId: string;
  /** Key privada: sólo servidor. */
  privateKey: string | null;
  /** Key pública: tokeniza la tarjeta en el navegador. */
  publicKey: string | null;
  /** Base de la API, compartida por todas las cuentas: https, sin barra final ni `/api/v2`. */
  baseUrl: string | null;
}

const MP_TOKEN = "MP_ACCESS_TOKEN_";
const MP_PUBLICA = "MP_PUBLIC_KEY_";
const MP_SECRETO = "MP_WEBHOOK_SECRET_";
const PW_PRIVADA = "PAYWAY_API_PRIVATE_KEY_";
const PW_PUBLICA = "PAYWAY_API_PUBLIC_KEY_";
const PW_BASE = "PAYWAY_BASE_URL";

/** Valor de la variable, sin espacios; vacío = ausente. */
function leer(valor: string | undefined): string | null {
  const v = valor?.trim();
  return v ? v : null;
}

function sufijo(cuenta: string): string {
  if (typeof cuenta !== "string") throw new Error("Falta la cuenta del procesador de pago.");
  return slugAVariable(cuenta);
}

export function credencialesMercadoPago(cuenta: string, env: Entorno = process.env): CredencialesMercadoPago {
  const s = sufijo(cuenta);
  return {
    cuentaId: cuenta,
    accessToken: leer(env[MP_TOKEN + s]),
    publicKey: leer(env[MP_PUBLICA + s]),
    webhookSecret: leer(env[MP_SECRETO + s]),
  };
}

/** Base de la API de Payway (compartida), o null si falta o no es https. */
export function paywayBaseUrl(env: Entorno = process.env): string | null {
  const crudo = leer(env[PW_BASE]);
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

export function credencialesPayway(cuenta: string, env: Entorno = process.env): CredencialesPayway {
  const s = sufijo(cuenta);
  return {
    cuentaId: cuenta,
    privateKey: leer(env[PW_PRIVADA + s]),
    publicKey: leer(env[PW_PUBLICA + s]),
    baseUrl: paywayBaseUrl(env),
  };
}

/**
 * ¿La cuenta tiene el juego completo para cobrar? Mercado Pago: access token y public key (el secreto
 * del webhook hace falta para validar avisos, no para cobrar). Payway: key privada, pública y base https.
 * Un procesador desconocido nunca está configurado.
 */
export function cuentaConfigurada(procesador: string, cuenta: string, env: Entorno = process.env): boolean {
  if (procesador === "mercadopago") {
    const c = credencialesMercadoPago(cuenta, env);
    return Boolean(c.accessToken && c.publicKey);
  }
  if (procesador === "payway") {
    const c = credencialesPayway(cuenta, env);
    return Boolean(c.privateKey && c.publicKey && c.baseUrl);
  }
  return false;
}

/** Sufijos presentes en el entorno con ese prefijo y valor no vacío. */
function sufijosCon(prefijo: string, env: Entorno): string[] {
  return Object.keys(env)
    .filter((k) => k.startsWith(prefijo) && k.length > prefijo.length && leer(env[k]) !== null)
    .map((k) => k.slice(prefijo.length));
}

/**
 * ¿Hay AL MENOS una cuenta del procesador con el juego completo? Es lo que decide si el medio se ofrece.
 * Sincrónica y sin base: recorre los nombres de las variables (no recupera el slug, sólo responde sí/no).
 */
export function hayCuentaConfigurada(procesador: string, env: Entorno = process.env): boolean {
  if (procesador === "mercadopago") {
    return sufijosCon(MP_TOKEN, env).some((s) => leer(env[MP_PUBLICA + s]) !== null);
  }
  if (procesador === "payway") {
    if (!paywayBaseUrl(env)) return false;
    return sufijosCon(PW_PRIVADA, env).some((s) => leer(env[PW_PUBLICA + s]) !== null);
  }
  return false;
}

/** De los slugs conocidos (sucursales del CRM), los que tienen el juego completo del procesador. */
export function cuentasConfiguradas(procesador: string, slugs: readonly string[], env: Entorno = process.env): string[] {
  return slugs.filter((s) => cuentaConfigurada(procesador, s, env));
}

/** De los slugs conocidos, los que tienen cargado el secreto del webhook de Mercado Pago. */
export function cuentasConSecreto(procesador: "mercadopago", slugs: readonly string[], env: Entorno = process.env): string[] {
  void procesador;
  return slugs.filter((s) => credencialesMercadoPago(s, env).webhookSecret !== null);
}

/**
 * Lo que la CSP del checkout necesita de Payway: el ORIGEN de la base compartida, sólo si hay alguna
 * cuenta Payway completa. La key pública nunca estuvo en la política.
 */
export function paywayParaCsp(env: Entorno = process.env): { origen: string } | null {
  if (!hayCuentaConfigurada("payway", env)) return null;
  const base = paywayBaseUrl(env);
  return base ? { origen: new URL(base).origin } : null;
}
