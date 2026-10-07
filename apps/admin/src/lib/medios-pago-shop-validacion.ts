// Validación pura de los medios de pago del checkout (sin DB, sin Next): la comparten la API y el
// formulario de Configuración → Sucursales y ventas. Textos en usted.

import { validarChips, type ChipMedio } from "@/lib/medios-pago-shop-chips"

export const SLUG_MEDIO_RE = /^[a-z0-9-]{2,30}$/
export const MAX_NOMBRE = 60
export const MAX_INSTRUCCIONES = 1000
export const MAX_ORDEN = 999
/** Fila fija sembrada por la migración 0057: se edita, pero no se crea, no se elimina ni cambia su slug. */
export const SLUG_MERCADOPAGO = "mercadopago"
/** Fila fija sembrada por la migración 0067 (misma regla que Mercado Pago). */
export const SLUG_PAYWAY = "payway"
/**
 * Filas fijas de cobro en línea: no se crean ni se eliminan desde el admin y `cobro_online` no se
 * edita. Cada una tiene su procesador (credenciales en la tienda) y sus propias condiciones de cuotas.
 */
export const SLUGS_COBRO: readonly string[] = [SLUG_MERCADOPAGO, SLUG_PAYWAY]

export function esSlugCobro(slug: string): boolean {
  return SLUGS_COBRO.includes(slug)
}

/** Quién puede pagar con el medio. `cuenta_corriente` = solo clientes con cuenta corriente (migración 0069). */
export type AudienciaMedio = "publico" | "cuenta_corriente"
export const AUDIENCIA_CUENTA_CORRIENTE: AudienciaMedio = "cuenta_corriente"

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
  /** Ausente en el alta = rige el default de la base ('publico'). */
  audiencia?: AudienciaMedio
  /** Etiquetas del medio en el checkout (migración 0071). Ausente en el alta = [] (default de la base). */
  chips?: ChipMedio[]
}

/** Cambios parciales: además de los campos del medio, destacado y ficha. La lista se enlaza por Precios online. */
export type CambiosMedioPago = Partial<Omit<MedioPagoValido, "slug">> & {
  destacarEnCatalogo?: boolean
  mostrarEnFicha?: boolean
}

/** Campos que sólo se configuran editando un medio ya creado. */
const CAMPOS_DE_PRECIO = ["destacarEnCatalogo", "mostrarEnFicha"] as const

const invalido = (campo: string, error: string): Invalido => ({ ok: false, campo, error })
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

const MSG_BODY = "Los datos indicados no son válidos."
const MSG_BOOL = "El valor indicado no es válido."
export const MSG_SIN_ENTREGA = "Seleccione al menos una forma de entrega: retiro o envío."
export const MSG_CC_ENTREGA = "El medio solo para cuentas corrientes debe aplicar a retiro y a envío."
export const MSG_CC_COBRO_ONLINE = "Un medio de cobro en línea no puede ser solo para cuentas corrientes."
export const MSG_CC_PRECIOS =
  "El medio solo para cuentas corrientes no puede destacarse en el catálogo ni mostrarse en la ficha. Quite esas opciones primero."
export const MSG_CC_OTRO = "Ya hay otro medio solo para cuentas corrientes. Quite esa opción del otro medio antes de marcar éste."
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

  for (const campo of ["activo", "aplicaRetiro", "aplicaEnvio", "cobroOnline", "destacarEnCatalogo", "mostrarEnFicha"] as const) {
    const v = body[campo]
    if (v === undefined) continue
    if (typeof v !== "boolean") return invalido(campo, MSG_BOOL)
    cambios[campo] = v
  }
  if (cambios.cobroOnline === true) return invalido("cobroOnline", MSG_COBRO_ONLINE)

  if (body.audiencia !== undefined) {
    if (body.audiencia !== "publico" && body.audiencia !== "cuenta_corriente") return invalido("audiencia", MSG_BOOL)
    cambios.audiencia = body.audiencia
  }

  if (body.chips !== undefined) {
    const r = validarChips(body.chips)
    if (!r.ok) return invalido("chips", r.error)
    cambios.chips = r.chips
  }

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
  if (esSlugCobro(slug)) return invalido("slug", "Ese identificador está reservado.")
  if (typeof body.nombre !== "string" || body.nombre.trim() === "") return invalido("nombre", "Ingrese el nombre.")

  const c = validarCampos(body)
  if (!c.ok) return c
  // El destacado y la ficha se configuran editando el medio ya creado.
  for (const campo of CAMPOS_DE_PRECIO) delete c.cambios[campo]
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
  if (valor.audiencia === AUDIENCIA_CUENTA_CORRIENTE && !(valor.aplicaRetiro && valor.aplicaEnvio)) {
    return invalido("aplicaRetiro", MSG_CC_ENTREGA)
  }
  return { ok: true, valor }
}

/** El slug no se modifica: si viene en el cambio parcial se ignora. */
export function validarMedioPagoCambios(body: unknown): { ok: true; cambios: CambiosMedioPago } | Invalido {
  if (!esObjeto(body)) return invalido("body", MSG_BODY)
  return validarCampos(body)
}
