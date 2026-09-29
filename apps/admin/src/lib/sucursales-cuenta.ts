import type { TenantConfig } from "@/lib/tenants"

// Config de Alegra de una cuenta / sucursal (change `sucursales-igz-mdp`, rebanada D). Puro:
// la lectura de la DB vive en `alegra-cuentas-repo.ts`.
//
//  - La cuenta PRINCIPAL no guarda credenciales: devuelve el TenantConfig del tenant tal cual.
//  - Las secundarias sobreescriben `alegraEmail / alegraToken / alegraMock`; el resto del config
//    (Resend, ai-api, etc.) es el del tenant.
//  - Fallback de DESARROLLO: sin credenciales en la DB y fuera de producción se leen
//    `{PREFIJO_TENANT}_ALEGRA_EMAIL_{SLUG}` / `{PREFIJO_TENANT}_ALEGRA_TOKEN_{SLUG}` (para Central
//    Led / MDP: `CENTRAL_LED_ALEGRA_EMAIL_MDP` / `CENTRAL_LED_ALEGRA_TOKEN_MDP`, en `.env.local`).
//    Solo sirve para probar el multicuenta en local. NO se cargan en Vercel: en producción la
//    única fuente es la DB (una sola fuente de verdad, sin redeploy por cada alta).

export interface CuentaCredenciales {
  slug: string
  principal: boolean
  alegraEmail: string
  alegraToken: string
  alegraMock: boolean
}

export type Entorno = Record<string, string | undefined>

export const MSG_SIN_CUENTA = "La sucursal no tiene una cuenta de Alegra asignada."
export const MSG_SIN_CREDENCIALES = "La cuenta de Alegra de la sucursal no tiene credenciales cargadas."

const aPrefijo = (s: string) => s.toUpperCase().replace(/-/g, "_")

/** ¿Estamos en producción? El fallback de desarrollo queda deshabilitado a propósito. */
export function esProduccion(env: Entorno = process.env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production"
}

/** Credenciales de desarrollo desde el entorno, o null (en producción, siempre null). */
export function credencialesDeDesarrollo(
  tenantId: string,
  slug: string,
  env: Entorno = process.env,
): { email: string; token: string } | null {
  if (esProduccion(env)) return null
  const base = `${aPrefijo(tenantId)}_ALEGRA`
  const email = env[`${base}_EMAIL_${aPrefijo(slug)}`]
  const token = env[`${base}_TOKEN_${aPrefijo(slug)}`]
  if (!email || !token) return null
  return { email, token }
}

/**
 * TenantConfig para hablar con Alegra usando la cuenta dada. Lanza con un mensaje en usted si la
 * cuenta secundaria no tiene credenciales (y no aplica el fallback de desarrollo): nunca se llama
 * a Alegra con las de otra cuenta.
 */
export function configParaCuenta(base: TenantConfig, cuenta: CuentaCredenciales, env: Entorno = process.env): TenantConfig {
  if (cuenta.principal) return base
  if (cuenta.alegraMock) return { ...base, alegraEmail: "", alegraToken: "", alegraMock: true }
  if (cuenta.alegraEmail && cuenta.alegraToken) {
    return { ...base, alegraEmail: cuenta.alegraEmail, alegraToken: cuenta.alegraToken, alegraMock: false }
  }
  const dev = credencialesDeDesarrollo(base.id, cuenta.slug, env)
  if (dev) return { ...base, alegraEmail: dev.email, alegraToken: dev.token, alegraMock: false }
  throw new Error(MSG_SIN_CREDENCIALES)
}

/** Config para una sucursal SIN cuenta asignada: solo el fallback de desarrollo, por slug de sucursal. */
export function configParaSucursalSinCuenta(base: TenantConfig, slugSucursal: string, env: Entorno = process.env): TenantConfig {
  const dev = credencialesDeDesarrollo(base.id, slugSucursal, env)
  if (!dev) throw new Error(MSG_SIN_CUENTA)
  return { ...base, alegraEmail: dev.email, alegraToken: dev.token, alegraMock: false }
}

/** Últimos 4 caracteres del token para mostrar; null si es tan corto que revelarlos lo expondría. */
export function ultimos4(token: string): string | null {
  return token.length >= 12 ? token.slice(-4) : null
}
