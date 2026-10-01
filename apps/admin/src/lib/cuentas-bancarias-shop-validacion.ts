// Validación pura de las cuentas bancarias del Shop (sin DB, sin Next): la comparten la API y el
// formulario del admin. Textos en usted. Las reglas de aplicación (sucursales y rango de montos)
// se validan acá; que cada slug exista en `sucursales` lo verifica el repo (necesita la DB).

export const MAX_ALIAS = 60
export const MAX_TEXTO = 120
export const MAX_ORDEN = 999
export const MAX_MONTO = 999_999_999_999.99

export const MSG_SUCURSALES = "Seleccione 'Todas las sucursales' o al menos una sucursal."
export const MSG_RANGO = "El monto mínimo no puede superar al máximo. Revíselo e inténtelo nuevamente."
export const MSG_DESACTIVAR_PREDETERMINADA = "Elija otra cuenta predeterminada antes de desactivar esta."

export type Invalido = { ok: false; campo: string; error: string }

export interface CuentaBancariaValida {
  alias: string
  cbu: string
  banco: string
  titular: string
  cuit: string
  todasLasSucursales: boolean
  sucursalSlugs: string[]
  montoMin: number | null
  montoMax: number | null
  activa: boolean
  predeterminada: boolean
  orden: number
}

const invalido = (campo: string, error: string): Invalido => ({ ok: false, campo, error })
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

type Parcial<T> = { ok: true; valor: T } | Invalido

function textoOpcional(v: unknown, campo: string, etiqueta: string): Parcial<string> {
  if (v === undefined || v === null) return { ok: true, valor: "" }
  if (typeof v !== "string") return invalido(campo, `${etiqueta} indicado no es válido.`)
  const t = v.trim()
  if (t.length > MAX_TEXTO) return invalido(campo, `${etiqueta} admite hasta ${MAX_TEXTO} caracteres.`)
  return { ok: true, valor: t }
}

/** Vacío o null = sin límite. Acepta número o texto con coma o punto, hasta dos decimales. */
function monto(v: unknown, campo: string, minimoExclusivo: boolean): Parcial<number | null> {
  if (v === undefined || v === null) return { ok: true, valor: null }
  let n: number
  if (typeof v === "number") n = v
  else if (typeof v === "string") {
    const t = v.trim()
    if (t === "") return { ok: true, valor: null }
    if (!/^\d+([.,]\d{1,2})?$/.test(t)) return invalido(campo, "Ingrese un monto válido, con hasta dos decimales.")
    n = Number(t.replace(",", "."))
  } else return invalido(campo, "Ingrese un monto válido, con hasta dos decimales.")
  if (!Number.isFinite(n)) return invalido(campo, "Ingrese un monto válido, con hasta dos decimales.")
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return invalido(campo, "Ingrese un monto válido, con hasta dos decimales.")
  if (minimoExclusivo ? n <= 0 : n < 0) {
    return invalido(campo, minimoExclusivo ? "El monto máximo debe ser mayor que cero." : "El monto no puede ser negativo.")
  }
  if (n > MAX_MONTO) return invalido(campo, "El monto indicado es demasiado alto.")
  return { ok: true, valor: Math.round(n * 100) / 100 }
}

function bool(v: unknown, campo: string, porDefecto: boolean): Parcial<boolean> {
  if (v === undefined) return { ok: true, valor: porDefecto }
  if (typeof v !== "boolean") return invalido(campo, "El valor indicado no es válido.")
  return { ok: true, valor: v }
}

/** Valida una cuenta COMPLETA (alta, o la fusión de la actual con un cambio parcial). */
export function validarCuentaBancaria(body: unknown): { ok: true; valor: CuentaBancariaValida } | Invalido {
  if (!esObjeto(body)) return invalido("body", "Los datos indicados no son válidos.")

  const alias = typeof body.alias === "string" ? body.alias.trim() : ""
  if (alias === "") return invalido("alias", "Ingrese el alias.")
  if (alias.length > MAX_ALIAS) return invalido("alias", `El alias admite hasta ${MAX_ALIAS} caracteres.`)

  const cbu = typeof body.cbu === "string" ? body.cbu.trim() : ""
  if (!/^\d{22}$/.test(cbu)) return invalido("cbu", "El CBU debe tener 22 dígitos.")

  const banco = textoOpcional(body.banco, "banco", "El banco")
  if (!banco.ok) return banco
  const titular = textoOpcional(body.titular, "titular", "El titular")
  if (!titular.ok) return titular

  let cuit = ""
  if (body.cuit !== undefined && body.cuit !== null) {
    if (typeof body.cuit !== "string") return invalido("cuit", "El CUIT indicado no es válido.")
    cuit = body.cuit.replace(/[\s-]/g, "")
    if (cuit !== "" && !/^\d{11}$/.test(cuit)) return invalido("cuit", "El CUIT debe tener 11 dígitos.")
  }

  // "Todas las sucursales" es una elección explícita: sin ella hay que listar al menos una.
  const todas = body.todasLasSucursales
  if (todas !== undefined && typeof todas !== "boolean") return invalido("todasLasSucursales", "El valor indicado no es válido.")
  let sucursalSlugs: string[] = []
  if (body.sucursalSlugs !== undefined && body.sucursalSlugs !== null) {
    if (!Array.isArray(body.sucursalSlugs) || body.sucursalSlugs.some((s) => typeof s !== "string")) {
      return invalido("sucursalSlugs", "Las sucursales indicadas no son válidas.")
    }
    sucursalSlugs = [...new Set((body.sucursalSlugs as string[]).map((s) => s.trim()).filter((s) => s !== ""))]
  }
  if (todas === true) sucursalSlugs = []
  else if (sucursalSlugs.length === 0) return invalido("sucursalSlugs", MSG_SUCURSALES)

  const min = monto(body.montoMin, "montoMin", false)
  if (!min.ok) return min
  const max = monto(body.montoMax, "montoMax", true)
  if (!max.ok) return max
  if (min.valor !== null && max.valor !== null && min.valor > max.valor) return invalido("montoMin", MSG_RANGO)

  const activa = bool(body.activa, "activa", true)
  if (!activa.ok) return activa
  const predeterminada = bool(body.predeterminada, "predeterminada", false)
  if (!predeterminada.ok) return predeterminada
  if (predeterminada.valor && !activa.valor) return invalido("activa", MSG_DESACTIVAR_PREDETERMINADA)

  let orden = 0
  if (body.orden !== undefined) {
    const v = body.orden
    const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return invalido("orden", "Ingrese un número entero igual o mayor que cero.")
    if (n > MAX_ORDEN) return invalido("orden", `El máximo permitido es ${MAX_ORDEN}.`)
    orden = n
  }

  return {
    ok: true,
    valor: {
      alias,
      cbu,
      banco: banco.valor,
      titular: titular.valor,
      cuit,
      todasLasSucursales: todas === true,
      sucursalSlugs,
      montoMin: min.valor,
      montoMax: max.valor,
      activa: activa.valor,
      predeterminada: predeterminada.valor,
      orden,
    },
  }
}
