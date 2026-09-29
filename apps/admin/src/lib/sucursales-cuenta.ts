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

// ── Cuenta que factura un pedido (rebanada D, lote 3; design D5/D6) ──────────────────────────────
//
// Precedencia: (1) la cuenta que el operador eligió en el pedido; (2) la de la sucursal que
// `regla.facturaSucursal` fuerza (zona Misiones → Iguazú); (3) la de la sucursal que despacha
// (`orders.sucursal`). Un pedido anterior a las sucursales (sin `sucursal`) factura con la cuenta
// principal. Si la sucursal que corresponde no tiene cuenta, NO se cae a otra en silencio: se
// devuelve `sin_cuenta` para que el operador elija a mano (facturar por la empresa equivocada es
// un problema fiscal, no un detalle).

export interface SucursalCuentaDato {
  slug: string
  cuentaAlegraId: string | null
}

export type MotivoCuentaFactura = "override" | "zona" | "despacho" | "principal" | "sin_cuenta"

export interface ResolucionCuentaFactura {
  cuentaId: string | null
  motivo: MotivoCuentaFactura
  /** Sucursal que aportó la cuenta (la de la zona o la que despacha); null si fue el override o la principal. */
  sucursal: string | null
}

export interface EntradaCuentaFactura {
  /** `pedido_factura_cuenta.cuenta_override_id`. */
  override: string | null
  /** `orders.sucursal_regla.facturaSucursal` (slug) o null. */
  facturaSucursal: string | null
  /** `orders.sucursal` (slug) o null (pedido anterior a las sucursales). */
  sucursalDespacho: string | null
  sucursales: SucursalCuentaDato[]
  cuentaPrincipalId: string | null
}

const cuentaDe = (slug: string, sucursales: SucursalCuentaDato[]) =>
  sucursales.find((s) => s.slug === slug)?.cuentaAlegraId ?? null

export function resolverCuentaFactura(e: EntradaCuentaFactura): ResolucionCuentaFactura {
  if (e.override) return { cuentaId: e.override, motivo: "override", sucursal: null }
  if (e.facturaSucursal) {
    const cuentaId = cuentaDe(e.facturaSucursal, e.sucursales)
    return cuentaId
      ? { cuentaId, motivo: "zona", sucursal: e.facturaSucursal }
      : { cuentaId: null, motivo: "sin_cuenta", sucursal: e.facturaSucursal }
  }
  if (e.sucursalDespacho) {
    const cuentaId = cuentaDe(e.sucursalDespacho, e.sucursales)
    return cuentaId
      ? { cuentaId, motivo: "despacho", sucursal: e.sucursalDespacho }
      : { cuentaId: null, motivo: "sin_cuenta", sucursal: e.sucursalDespacho }
  }
  return e.cuentaPrincipalId
    ? { cuentaId: e.cuentaPrincipalId, motivo: "principal", sucursal: null }
    : { cuentaId: null, motivo: "sin_cuenta", sucursal: null }
}

/**
 * ¿La cuenta que factura es distinta de la de la sucursal que despacha? (venta entre empresas: el
 * stock lo descuenta la que despacha y la reserva sigue ahí). Sin cuenta en alguno de los dos lados
 * no se puede afirmar que sea cruzada: false.
 */
export function esFacturaCruzada(e: {
  cuentaFacturaId: string | null
  sucursalDespacho: string | null
  sucursales: SucursalCuentaDato[]
  cuentaPrincipalId: string | null
}): boolean {
  if (!e.cuentaFacturaId) return false
  const cuentaDespacho = e.sucursalDespacho ? cuentaDe(e.sucursalDespacho, e.sucursales) : e.cuentaPrincipalId
  return !!cuentaDespacho && cuentaDespacho !== e.cuentaFacturaId
}

/** Por qué se ofrece esa cuenta, en usted. `provincia` = nombre legible si el motivo es la zona. */
export function textoMotivoCuentaFactura(motivo: MotivoCuentaFactura, provincia?: string | null): string {
  switch (motivo) {
    case "override":
      return "Elegida por un operador para este pedido"
    case "zona":
      return provincia ? `Por zona ${provincia}` : "Por la zona del pedido"
    case "despacho":
      return "Sucursal que despacha"
    case "principal":
      return "Cuenta principal (pedido anterior a las sucursales)"
    default:
      return "La sucursal no tiene una cuenta de Alegra asignada"
  }
}
