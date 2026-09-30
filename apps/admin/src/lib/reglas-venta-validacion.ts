// Validación pura de las reglas de venta (sin DB, sin Next): la comparten la API y el formulario
// de Configuración → Sucursales y ventas, así el operador ve el mismo mensaje en los dos lados.
// Textos en usted. Los valores por defecto son los del design (sí, ofrecer, 7, 7, 24, 24) y los
// usa también el Shop cuando el tenant no tiene fila.

export const RETIRO_SIN_STOCK = ["bloquear", "ofrecer"] as const
export type RetiroSinStock = (typeof RETIRO_SIN_STOCK)[number]

export interface ReglasVenta {
  respaldoEnvio: boolean
  retiroSinStock: RetiroSinStock
  trasladoDias: number
  reservaDias: number
  avisoSinContactarHoras: number
  contactoHorasHabiles: number
  /** Mensaje de confirmación de la compra; vacío = el que trae el Shop por defecto. */
  mensajeConfirmacion: string
}

export const REGLAS_VENTA_DEFAULT: ReglasVenta = {
  respaldoEnvio: true,
  retiroSinStock: "ofrecer",
  trasladoDias: 7,
  reservaDias: 7,
  avisoSinContactarHoras: 24,
  contactoHorasHabiles: 24,
  mensajeConfirmacion: "",
}

/** Variables que el Shop reemplaza en el mensaje de confirmación. */
export const VARIABLES_CONFIRMACION = ["plazo", "whatsapp"] as const
export const MAX_MENSAJE_CONFIRMACION = 1000

/** Topes razonables: evitan un 99999 por error de tipeo. */
export const MAX_DIAS = 365
export const MAX_HORAS = 720

export const MSG_ENTERO = "Ingrese un número entero igual o mayor que cero."

export type Invalido = { ok: false; campo: string; error: string }

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

const ENTEROS = [
  ["trasladoDias", "días", MAX_DIAS],
  ["reservaDias", "días", MAX_DIAS],
  ["avisoSinContactarHoras", "horas", MAX_HORAS],
  ["contactoHorasHabiles", "horas", MAX_HORAS],
] as const

/**
 * Valida los campos PRESENTES (cambio parcial); los ausentes no se devuelven. Un entero llega como
 * número o como texto numérico ("7"); cualquier otra cosa (negativo, decimal, vacío) es inválida.
 */
export function validarReglasVenta(body: unknown): { ok: true; cambios: Partial<ReglasVenta> } | Invalido {
  if (!esObjeto(body)) return { ok: false, campo: "body", error: "Los datos indicados no son válidos." }
  const cambios: Partial<ReglasVenta> = {}

  if (body.respaldoEnvio !== undefined) {
    if (typeof body.respaldoEnvio !== "boolean") return { ok: false, campo: "respaldoEnvio", error: "El valor indicado no es válido." }
    cambios.respaldoEnvio = body.respaldoEnvio
  }

  if (body.retiroSinStock !== undefined) {
    if (!RETIRO_SIN_STOCK.includes(body.retiroSinStock as RetiroSinStock)) {
      return { ok: false, campo: "retiroSinStock", error: "Seleccione una opción de la lista." }
    }
    cambios.retiroSinStock = body.retiroSinStock as RetiroSinStock
  }

  if (body.mensajeConfirmacion !== undefined) {
    if (typeof body.mensajeConfirmacion !== "string") {
      return { ok: false, campo: "mensajeConfirmacion", error: "El mensaje indicado no es válido." }
    }
    const msg = body.mensajeConfirmacion.trim()
    if (msg.length > MAX_MENSAJE_CONFIRMACION) {
      return { ok: false, campo: "mensajeConfirmacion", error: `El mensaje admite hasta ${MAX_MENSAJE_CONFIRMACION} caracteres.` }
    }
    const desconocida = [...msg.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).find((v) => !(VARIABLES_CONFIRMACION as readonly string[]).includes(v))
    if (desconocida !== undefined) {
      return {
        ok: false,
        campo: "mensajeConfirmacion",
        error: `La variable {${desconocida}} no existe. Use solo {plazo} y {whatsapp}.`,
      }
    }
    cambios.mensajeConfirmacion = msg
  }

  for (const [campo, unidad, max] of ENTEROS) {
    const v = body[campo]
    if (v === undefined) continue
    const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return { ok: false, campo, error: MSG_ENTERO }
    if (n > max) return { ok: false, campo, error: `El máximo permitido es ${max} ${unidad}.` }
    cambios[campo] = n
  }

  return { ok: true, cambios }
}
