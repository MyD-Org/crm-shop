// Validación pura de los medios de pago del checkout (sin DB, sin Next): la comparten la API y el
// formulario de Configuración → Sucursales y ventas. Textos en usted.

export const SLUG_MEDIO_RE = /^[a-z0-9-]{2,30}$/
export const MAX_NOMBRE = 60
export const MAX_INSTRUCCIONES = 1000
export const MAX_ORDEN = 999
/** Fila fija sembrada por la migración 0057: se edita, pero no se crea, no se elimina ni cambia su slug. */
export const SLUG_MERCADOPAGO = "mercadopago"

export type Invalido = { ok: false; campo: string; error: string }

export interface MedioPagoValido {
  slug: string
  nombre: string
  instrucciones: string
  activo: boolean
  aplicaRetiro: boolean
  aplicaEnvio: boolean
  cobroOnline: boolean
  orden: number
}

export type CambiosMedioPago = Partial<Omit<MedioPagoValido, "slug">>

const invalido = (campo: string, error: string): Invalido => ({ ok: false, campo, error })
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

const MSG_BODY = "Los datos indicados no son válidos."
const MSG_BOOL = "El valor indicado no es válido."
export const MSG_SIN_ENTREGA = "Seleccione al menos una forma de entrega: retiro o envío."
export const MSG_COBRO_ONLINE = "El cobro online todavía no está disponible."

function validarCampos(body: Record<string, unknown>): { ok: true; cambios: CambiosMedioPago } | Invalido {
  const cambios: CambiosMedioPago = {}

  if (body.nombre !== undefined) {
    if (typeof body.nombre !== "string") return invalido("nombre", "El nombre indicado no es válido.")
    const n = body.nombre.trim()
    if (n === "") return invalido("nombre", "Ingrese el nombre.")
    if (n.length > MAX_NOMBRE) return invalido("nombre", `El nombre admite hasta ${MAX_NOMBRE} caracteres.`)
    cambios.nombre = n
  }

  if (body.instrucciones !== undefined) {
    if (typeof body.instrucciones !== "string") return invalido("instrucciones", "Las instrucciones indicadas no son válidas.")
    const i = body.instrucciones.trim()
    if (i.length > MAX_INSTRUCCIONES) {
      return invalido("instrucciones", `Las instrucciones admiten hasta ${MAX_INSTRUCCIONES} caracteres.`)
    }
    cambios.instrucciones = i
  }

  for (const campo of ["activo", "aplicaRetiro", "aplicaEnvio", "cobroOnline"] as const) {
    const v = body[campo]
    if (v === undefined) continue
    if (typeof v !== "boolean") return invalido(campo, MSG_BOOL)
    cambios[campo] = v
  }
  if (cambios.cobroOnline === true) return invalido("cobroOnline", MSG_COBRO_ONLINE)

  if (body.orden !== undefined) {
    const v = body.orden
    const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      return invalido("orden", "Ingrese un número entero igual o mayor que cero.")
    }
    if (n > MAX_ORDEN) return invalido("orden", `El máximo permitido es ${MAX_ORDEN}.`)
    cambios.orden = n
  }

  if (cambios.aplicaRetiro === false && cambios.aplicaEnvio === false) return invalido("aplicaRetiro", MSG_SIN_ENTREGA)
  return { ok: true, cambios }
}

export function validarMedioPagoNuevo(body: unknown): { ok: true; valor: MedioPagoValido } | Invalido {
  if (!esObjeto(body)) return invalido("body", MSG_BODY)

  const slug = typeof body.slug === "string" ? body.slug.trim() : ""
  if (slug === "") return invalido("slug", "Ingrese el identificador.")
  if (!SLUG_MEDIO_RE.test(slug)) {
    return invalido("slug", "El identificador debe tener de 2 a 30 caracteres: minúsculas, números o guiones.")
  }
  if (slug === SLUG_MERCADOPAGO) return invalido("slug", "Ese identificador está reservado.")
  if (typeof body.nombre !== "string" || body.nombre.trim() === "") return invalido("nombre", "Ingrese el nombre.")

  const c = validarCampos(body)
  if (!c.ok) return c
  const valor: MedioPagoValido = {
    slug,
    nombre: "",
    instrucciones: "",
    activo: true,
    aplicaRetiro: true,
    aplicaEnvio: true,
    cobroOnline: false,
    orden: 0,
    ...c.cambios,
  }
  if (!valor.aplicaRetiro && !valor.aplicaEnvio) return invalido("aplicaRetiro", MSG_SIN_ENTREGA)
  return { ok: true, valor }
}

/** El slug no se modifica: si viene en el cambio parcial se ignora. */
export function validarMedioPagoCambios(body: unknown): { ok: true; cambios: CambiosMedioPago } | Invalido {
  if (!esObjeto(body)) return invalido("body", MSG_BODY)
  return validarCampos(body)
}
