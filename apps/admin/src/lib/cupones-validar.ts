// Validación pura de una promoción de cupones (spec 2026-11-01-cupones-design.md). Lo que depende
// de la base (código repetido, medio de cuenta corriente, canjes existentes) lo valida
// `cupones-repo.ts` dentro de la transacción. Textos en usted: se muestran tal cual en el admin.
import { ISO_CON_ZONA } from "@/lib/campanias-validar"
import { normalizarCodigo } from "@/lib/cupones-codigo"
import { SLUG_MEDIO_RE } from "@/lib/medios-pago-shop-validacion"

export type TipoPromocion = "generica" | "unicos"
export type FormaCupon = "credito" | "debito" | "cuenta_mp"

export interface PromocionEntrada {
  nombre: string
  tipo: TipoPromocion
  /** Sólo genérica: normalizado (mayúsculas, [A-Z0-9]). */
  codigo?: string
  /** Sólo únicos: 2 a 8 letras en mayúsculas. */
  prefijo?: string
  pct: number | null
  envioGratis: boolean
  /** NULL = donde la tienda ya hace envío a domicilio. */
  provinciasEnvio: string[] | null
  /** ISO con offset (p. ej. "2026-11-27T00:00:00-03:00"); fin exclusivo. */
  inicio: string
  fin: string
  /** Sólo únicos. */
  venceDiasDesdeEmision: number | null
  soloPrimeraCompra: boolean
  /** Con IVA, sobre todo el carrito a la lista general. */
  minimo: number | null
  /** Slugs de medios_pago_shop (más `a_coordinar`); NULL = todos los públicos. */
  medios: string[] | null
  formas: FormaCupon[] | null
  permiteCuotas: boolean
  limiteCanjes: number | null
  condiciones: string
}

export type EstadoPromocion = "programada" | "activa" | "pausada" | "terminada"

/** Medio de los pedidos a confirmar por venta sin stock: no es una fila de medios_pago_shop. */
export const SLUG_A_COORDINAR = "a_coordinar"
export const FORMAS_CUPON: readonly FormaCupon[] = ["credito", "debito", "cuenta_mp"]
export const NOMBRE_MAX = 80
export const CONDICIONES_MAX = 2000
export const PCT_MAX = 50
export const DIAS_MAX = 365
const CODIGO_RE = /^[A-Z0-9]{4,24}$/
const PREFIJO_RE = /^[A-Z]{2,8}$/

function fecha(v: unknown): Date | null {
  if (typeof v !== "string" || !ISO_CON_ZONA.test(v)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const entero = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max

/** Lista de textos; vacía o ausente = null (todas). `null` si algún elemento no es texto. */
function lista(v: unknown): string[] | null | false {
  if (v == null) return null
  if (!Array.isArray(v)) return false
  const xs = v.map((x) => (typeof x === "string" ? x.trim() : null))
  if (xs.some((x) => x === null || x === "")) return false
  const unicos = [...new Set(xs as string[])]
  return unicos.length > 0 ? unicos : null
}

export function validarPromocion(e: unknown): { ok: true; valor: PromocionEntrada } | { ok: false; errores: string[] } {
  const errores: string[] = []
  const agregar = (m: string) => {
    if (!errores.includes(m)) errores.push(m)
  }
  const o = e && typeof e === "object" ? (e as Record<string, unknown>) : {}

  const nombre = texto(o.nombre)
  if (!nombre) agregar("Ingrese un nombre para la promoción.")
  else if (nombre.length > NOMBRE_MAX) agregar(`El nombre admite hasta ${NOMBRE_MAX} caracteres.`)

  const tipo = o.tipo
  if (tipo !== "generica" && tipo !== "unicos") agregar("Indique el tipo de promoción.")

  let codigo: string | undefined
  let prefijo: string | undefined
  if (tipo === "generica") {
    codigo = normalizarCodigo(texto(o.codigo))
    if (!CODIGO_RE.test(codigo)) agregar("Ingrese un código de 4 a 24 letras o números.")
  }
  if (tipo === "unicos") {
    prefijo = texto(o.prefijo).toUpperCase()
    if (!PREFIJO_RE.test(prefijo)) agregar("Ingrese un prefijo de 2 a 8 letras.")
  }

  const pct = o.pct ?? null
  if (pct !== null && !entero(pct, 1, PCT_MAX)) agregar(`El descuento debe ser un número entero entre 1 y ${PCT_MAX}.`)
  const envioGratis = o.envioGratis === true
  if (pct === null && !envioGratis) agregar("Indique un descuento o envío gratis.")

  const provincias = lista(o.provinciasEnvio)
  if (provincias === false) agregar("Hay una provincia inválida.")

  const inicio = fecha(o.inicio)
  const fin = fecha(o.fin)
  if (!inicio) agregar("Indique una fecha de inicio válida.")
  if (!fin) agregar("Indique una fecha de fin válida.")
  if (inicio && fin && fin.getTime() <= inicio.getTime()) agregar("La fecha de fin debe ser posterior al inicio.")

  const dias = tipo === "unicos" ? (o.venceDiasDesdeEmision ?? null) : null
  if (dias !== null && !entero(dias, 1, DIAS_MAX)) {
    agregar(`Los días de vencimiento deben ser un número entero entre 1 y ${DIAS_MAX}.`)
  }

  const minimo = o.minimo ?? null
  if (minimo !== null && !(typeof minimo === "number" && Number.isFinite(minimo) && minimo > 0)) {
    agregar("La compra mínima debe ser un monto mayor que 0.")
  }

  const medios = lista(o.medios)
  if (medios === false || (medios && medios.some((m) => m !== SLUG_A_COORDINAR && !SLUG_MEDIO_RE.test(m)))) {
    agregar("Hay un medio de pago inválido.")
  }
  const formas = lista(o.formas)
  if (formas === false || (formas && formas.some((f) => !FORMAS_CUPON.includes(f as FormaCupon)))) {
    agregar("Hay una forma de pago inválida.")
  }

  const limite = o.limiteCanjes ?? null
  if (limite !== null && !entero(limite, 1, Number.MAX_SAFE_INTEGER)) {
    agregar("El límite de canjes debe ser un número entero mayor que 0.")
  }

  const condiciones = texto(o.condiciones)
  if (condiciones.length > CONDICIONES_MAX) agregar(`Las condiciones admiten hasta ${CONDICIONES_MAX} caracteres.`)

  if (errores.length > 0) return { ok: false, errores }
  return {
    ok: true,
    valor: {
      nombre,
      tipo: tipo as TipoPromocion,
      ...(codigo !== undefined ? { codigo } : {}),
      ...(prefijo !== undefined ? { prefijo } : {}),
      pct: pct as number | null,
      envioGratis,
      provinciasEnvio: provincias || null,
      inicio: o.inicio as string,
      fin: o.fin as string,
      venceDiasDesdeEmision: dias as number | null,
      soloPrimeraCompra: o.soloPrimeraCompra !== false,
      minimo: minimo as number | null,
      medios: medios || null,
      formas: (formas || null) as FormaCupon[] | null,
      permiteCuotas: o.permiteCuotas === true,
      limiteCanjes: limite as number | null,
      condiciones,
    },
  }
}

/** Terminada (fin exclusivo) > pausada > programada / activa. */
export function estadoPromocion(p: { inicio: Date; fin: Date; activa: boolean }, ahora: Date): EstadoPromocion {
  const t = ahora.getTime()
  if (t >= p.fin.getTime()) return "terminada"
  if (!p.activa) return "pausada"
  return t < p.inicio.getTime() ? "programada" : "activa"
}
