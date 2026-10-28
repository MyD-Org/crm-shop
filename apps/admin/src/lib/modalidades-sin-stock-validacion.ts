// Validación pura de las modalidades de venta sin stock (sin DB, sin Next): la comparten la API y
// el formulario del CRM. Textos en usted. Mismos límites que los CHECK de la migración 0094.

export type FlujoSinStock = "en_linea" | "a_confirmar"

export interface ModalidadSinStock {
  id: string
  /** Nombre interno: sólo existe en el CRM y en el snapshot del pedido. */
  nombre: string
  /** Texto que ve el comprador. */
  texto: string
  /** Días hábiles; null = a coordinar. */
  plazoDias: number | null
  flujo: FlujoSinStock
  activa: boolean
}

export type ModalidadEntrada = Omit<ModalidadSinStock, "id">

export const MAX_NOMBRE = 60
export const MAX_TEXTO = 40
export const MIN_PLAZO = 1
export const MAX_PLAZO = 60

export const MSG_NOMBRE = `Ingrese un nombre de hasta ${MAX_NOMBRE} caracteres.`
export const MSG_NOMBRE_DUPLICADO = "Ya existe una modalidad con ese nombre."
export const MSG_TEXTO = `Ingrese el texto para el comprador (hasta ${MAX_TEXTO} caracteres).`
export const MSG_PLAZO = `Ingrese un número entero de días hábiles entre ${MIN_PLAZO} y ${MAX_PLAZO}, o elija «A coordinar».`
export const MSG_FLUJO = "Seleccione el flujo de pago."
export const MSG_ACTIVA = "El valor indicado no es válido."
export const MSG_BODY = "Los datos indicados no son válidos."

export type Invalido = { ok: false; campo: string; error: string }

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Texto no vacío (recortado) de hasta `max`; null si no cumple. */
const textoAcotado = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length >= 1 && t.length <= max ? t : null
}

/** Plazo como número o texto ("3"); `undefined` si es inválido, null = a coordinar. */
function parsearPlazo(v: unknown): number | null | undefined {
  if (v === null) return null
  let n: number
  if (typeof v === "number") n = v
  else if (typeof v === "string" && /^\s*\d+\s*$/.test(v)) n = Number(v.trim())
  else return undefined
  return Number.isInteger(n) && n >= MIN_PLAZO && n <= MAX_PLAZO ? n : undefined
}

export function validarModalidad(body: unknown): { ok: true; modalidad: ModalidadEntrada } | Invalido {
  if (!esObjeto(body)) return { ok: false, campo: "body", error: MSG_BODY }
  const nombre = textoAcotado(body.nombre, MAX_NOMBRE)
  if (nombre === null) return { ok: false, campo: "nombre", error: MSG_NOMBRE }
  const texto = textoAcotado(body.texto, MAX_TEXTO)
  if (texto === null) return { ok: false, campo: "texto", error: MSG_TEXTO }
  const plazoDias = parsearPlazo(body.plazoDias)
  if (plazoDias === undefined) return { ok: false, campo: "plazoDias", error: MSG_PLAZO }
  if (body.flujo !== "en_linea" && body.flujo !== "a_confirmar") return { ok: false, campo: "flujo", error: MSG_FLUJO }
  if (typeof body.activa !== "boolean") return { ok: false, campo: "activa", error: MSG_ACTIVA }
  return { ok: true, modalidad: { nombre, texto, plazoDias, flujo: body.flujo, activa: body.activa } }
}

/** Advertencia (no bloquea): pago en línea sin ninguna fecha estimada para el comprador. */
export function avisoPlazoSinFecha(m: Pick<ModalidadEntrada, "plazoDias" | "flujo">): string | null {
  return m.plazoDias === null && m.flujo === "en_linea"
    ? "El plazo queda a coordinar y el pago es en línea: el comprador pagará sin una fecha estimada."
    : null
}

export function textoPlazo(plazoDias: number | null): string {
  if (plazoDias === null) return "a coordinar"
  return plazoDias === 1 ? "1 día hábil" : `${plazoDias} días hábiles`
}
