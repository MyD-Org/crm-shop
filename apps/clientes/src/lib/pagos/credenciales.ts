/**
 * Credenciales de los procesadores de pago: el ÚNICO lugar que las lee del entorno. SOLO servidor.
 *
 * Hoy hay un juego por procesador (cuenta `principal`). Más adelante habrá una cuenta de Mercado Pago y
 * una de Payway por sucursal (MDP / IGZ), elegida según la cuenta de Alegra del pedido: el contexto
 * (`sucursal`) ya viaja hasta acá para que ese cambio toque sólo este archivo y no a los llamadores.
 * La guarda de `credenciales.test.ts` impide leer estas variables en otro archivo de `lib/pagos`.
 */

export interface ContextoCredenciales {
  /** Sucursal del pedido (`orders.sucursal`). Hoy no cambia la cuenta. */
  sucursal?: string | null;
}

export interface CredencialesMercadoPago {
  /** Identifica la cuenta (logs, cachés por cuenta). */
  cuentaId: string;
  /** Access Token: sólo servidor. */
  accessToken: string | null;
  /** Public Key: la usa el Brick en el navegador. */
  publicKey: string | null;
  /** Clave secreta con la que Mercado Pago firma los webhooks. */
  webhookSecret: string | null;
}

export interface CredencialesPayway {
  cuentaId: string;
  /** Key privada: sólo servidor. */
  privateKey: string | null;
  /** Key pública: tokeniza la tarjeta en el navegador. */
  publicKey: string | null;
  /** Base de la API tal como está en el entorno (la valida `payway.ts`). */
  baseUrl: string | null;
}

const CUENTA_PRINCIPAL = "principal";

/** Valor de la variable, sin espacios; vacío = ausente. */
function leer(valor: string | undefined): string | null {
  const v = valor?.trim();
  return v ? v : null;
}

export function credencialesMercadoPago(ctx?: ContextoCredenciales): CredencialesMercadoPago {
  void ctx;
  return {
    cuentaId: CUENTA_PRINCIPAL,
    accessToken: leer(process.env.MP_ACCESS_TOKEN),
    publicKey: leer(process.env.NEXT_PUBLIC_MP_PUBLIC_KEY),
    webhookSecret: leer(process.env.MP_WEBHOOK_SECRET),
  };
}

export function credencialesPayway(ctx?: ContextoCredenciales): CredencialesPayway {
  void ctx;
  return {
    cuentaId: CUENTA_PRINCIPAL,
    privateKey: leer(process.env.PAYWAY_API_PRIVATE_KEY),
    publicKey: leer(process.env.PAYWAY_API_PUBLIC_KEY),
    baseUrl: leer(process.env.PAYWAY_BASE_URL),
  };
}
