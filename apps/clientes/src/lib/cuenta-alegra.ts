/**
 * Cuenta de Alegra del despliegue y sus credenciales: el ÚNICO lugar que las lee del entorno. SOLO servidor.
 *
 * Cada proyecto de Vercel del Shop opera contra UNA cuenta de Alegra del tenant (change
 * `shop-contactos-alegra-mdp`): `SHOP_CUENTA_ALEGRA` es su slug (`alegra_cuentas` del CRM). Ausente o
 * vacía = `principal`, que es el comportamiento de siempre. El slug decide las credenciales y, en los
 * cambios siguientes, el filtro `alegra_account` del espejo de contactos, los vínculos y los pedidos.
 *
 * Credenciales:
 * - `principal`: `ALEGRA_EMAIL` / `ALEGRA_TOKEN`.
 * - otra cuenta: `ALEGRA_EMAIL_<S>` / `ALEGRA_TOKEN_<S>`, con `<S>` = `slugAVariable(slug)` (la misma regla
 *   que las credenciales de pagos por sucursal: `mar-del-plata` -> `_MAR_DEL_PLATA`).
 *
 * Fail-closed: una cuenta secundaria sin sus credenciales NUNCA cae a las de la principal (un id de
 * contacto de una cuenta consultado con la credencial de otra es otra persona). Falta algo => throw con
 * los NOMBRES de las variables, nunca sus valores.
 *
 * Se lee en cada llamada (como `shopTenantId()`), nunca a nivel de módulo. La guarda de
 * `cuenta-alegra.test.ts` impide nombrar estas variables en cualquier otro archivo de `src`.
 *
 * Sin alias `@/` ni dependencias con red o base.
 */

import { slugAVariable } from "./pagos/cuenta-cobro";

export const CUENTA_PRINCIPAL = "principal";

/** Variables de entorno (inyectables en los tests). */
export type Entorno = Record<string, string | undefined>;

export interface CredencialesAlegra {
  /** La cuenta a la que pertenecen (logs y paridad). */
  cuenta: string;
  email: string;
  token: string;
}

/** Mismo formato que el CHECK de `alegra_account` en las tablas del Shop. */
const FORMATO_CUENTA = /^[a-z0-9][a-z0-9-]{0,39}$/;

const VAR_CUENTA = "SHOP_CUENTA_ALEGRA";
const VAR_EMAIL = "ALEGRA_EMAIL";
const VAR_TOKEN = "ALEGRA_TOKEN";

/** Valor de la variable, sin espacios; vacío = ausente. */
function leer(valor: string | undefined): string | null {
  const v = valor?.trim();
  return v ? v : null;
}

/** Slug de la cuenta de Alegra de este despliegue. Throw si el valor configurado no es un slug válido. */
export function shopCuentaAlegra(env: Entorno = process.env): string {
  const crudo = leer(env[VAR_CUENTA]);
  if (!crudo) return CUENTA_PRINCIPAL;
  const cuenta = crudo.toLowerCase();
  if (!FORMATO_CUENTA.test(cuenta)) {
    throw new Error(
      `${VAR_CUENTA} no es un slug de cuenta de Alegra válido (minúsculas, dígitos y "-", hasta 40 caracteres).`,
    );
  }
  return cuenta;
}

export function esCuentaPrincipal(env: Entorno = process.env): boolean {
  return shopCuentaAlegra(env) === CUENTA_PRINCIPAL;
}

/** Credenciales de la cuenta pedida. Throw si faltan; nunca devuelve las de otra cuenta. */
export function credencialesAlegra(cuenta: string, env: Entorno = process.env): CredencialesAlegra {
  if (typeof cuenta !== "string" || !FORMATO_CUENTA.test(cuenta)) {
    throw new Error("Cuenta de Alegra inválida: no se pueden resolver sus credenciales.");
  }
  const sufijo = cuenta === CUENTA_PRINCIPAL ? "" : `_${slugAVariable(cuenta)}`;
  const varEmail = VAR_EMAIL + sufijo;
  const varToken = VAR_TOKEN + sufijo;
  const email = leer(env[varEmail]);
  const token = leer(env[varToken]);
  if (!email || !token) {
    const faltan = [!email && varEmail, !token && varToken].filter(Boolean).join(" y ");
    throw new Error(`Faltan credenciales de Alegra de la cuenta "${cuenta}": ${faltan}. Configure el entorno del proyecto.`);
  }
  return { cuenta, email, token };
}
