// Validación pura de la cuenta de Alegra de una sucursal (change `sucursales-igz-mdp`, rebanada D).
// La comparten la API y el formulario del backoffice: el mensaje es el mismo en los dos lados.
// Textos en usted. Sin DB, sin Next.

export type Invalido = { ok: false; campo: string; error: string }

export const CUENTA_SLUG_RE = /^[a-z0-9-]{2,12}$/
export const MAX_EMAIL = 200
export const MAX_TOKEN = 200
export const MAX_NOMBRE = 80

export type ModoCuenta = "ninguna" | "principal" | "propia"

export interface CuentaEntrada {
  modo: ModoCuenta
  /** Solo dígitos. undefined = no se toca; "" = borrar. */
  cuit?: string
  // Solo modo "propia":
  email?: string
  /** undefined o "" = conservar el guardado (en el alta es obligatorio). */
  token?: string
  nombre?: string
}

const invalido = (campo: string, error: string): Invalido => ({ ok: false, campo, error })
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Deja solo los dígitos ("20-12345678-6" -> "20123456786"). */
export function soloDigitos(v: string): string {
  return v.replace(/\D/g, "")
}

/** CUIT/CUIL de 11 dígitos con dígito verificador (módulo 11). */
export function cuitValido(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(cuit[i]), 0)
  const resto = suma % 11
  const dv = resto === 0 ? 0 : 11 - resto
  // dv 10 no existe como dígito: ese prefijo no forma un CUIT válido.
  return dv !== 10 && dv === Number(cuit[10])
}

/** "20123456786" -> "20-12345678-6" (para mostrar). Si no son 11 dígitos, tal cual. */
export function formatearCuit(cuit: string): string {
  return /^\d{11}$/.test(cuit) ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : cuit
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Cuerpo de `PUT /api/admin/sucursales/[slug]/cuenta-alegra`. `esAlta` = la sucursal todavía no
 * tiene una cuenta propia: en ese caso el correo y el token son obligatorios.
 */
export function validarCuentaEntrada(
  body: unknown,
  opts: { esAlta: boolean },
): { ok: true; valor: CuentaEntrada } | Invalido {
  if (!esObjeto(body)) return invalido("body", "La solicitud no es válida.")
  const modo = body.modo
  if (modo !== "ninguna" && modo !== "principal" && modo !== "propia") {
    return invalido("modo", "Seleccione una opción de cuenta de Alegra.")
  }

  if (modo === "ninguna") return { ok: true, valor: { modo } }
  const valor: CuentaEntrada = { modo }

  if (body.cuit !== undefined) {
    if (typeof body.cuit !== "string") return invalido("cuit", "El CUIT no es válido.")
    const d = soloDigitos(body.cuit)
    if (d !== "" && !cuitValido(d)) return invalido("cuit", "Ingrese un CUIT válido de 11 dígitos.")
    valor.cuit = d
  }
  if (modo === "principal") return { ok: true, valor }

  // modo "propia"
  if (body.email !== undefined) {
    if (typeof body.email !== "string") return invalido("email", "El correo no es válido.")
    const email = body.email.trim()
    if (email.length > MAX_EMAIL || (email !== "" && !EMAIL_RE.test(email))) {
      return invalido("email", "Ingrese un correo válido.")
    }
    valor.email = email
  }
  if (opts.esAlta && !valor.email) return invalido("email", "Ingrese el correo de la cuenta de Alegra.")

  if (body.token !== undefined) {
    if (typeof body.token !== "string") return invalido("token", "El token no es válido.")
    const token = body.token.trim()
    if (token.length > MAX_TOKEN) return invalido("token", `El token admite hasta ${MAX_TOKEN} caracteres.`)
    if (token !== "") valor.token = token
  }
  if (opts.esAlta && !valor.token) return invalido("token", "Ingrese el token de la cuenta de Alegra.")

  if (body.nombre !== undefined) {
    if (typeof body.nombre !== "string") return invalido("nombre", "El nombre no es válido.")
    const nombre = body.nombre.trim()
    if (nombre.length > MAX_NOMBRE) return invalido("nombre", `El nombre admite hasta ${MAX_NOMBRE} caracteres.`)
    if (nombre !== "") valor.nombre = nombre
  }
  return { ok: true, valor }
}

/** Slug de la cuenta derivado del de la sucursal (la cuenta admite hasta 12 caracteres). */
export function slugDeCuenta(slugSucursal: string): string {
  return slugSucursal.slice(0, 12).replace(/^-+|-+$/g, "")
}
