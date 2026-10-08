// Validación pura de los cambios de precios online (sin DB, sin Next): la comparten la API y los
// tests. Textos en español formal de usted (los `error` se muestran tal cual en pantalla).
//
// Un "cambio" es una operación sobre las listas, sus overrides o los umbrales. La vista previa y
// el aplicar reciben el MISMO arreglo, así lo que se previsualizó es exactamente lo que se aplica.

import { esMarcaValida, ordenarMarcas } from "./marcas-tarjeta"

const SLUG_MEDIO_RE = /^[a-z0-9-]{2,30}$/
// Cuenta de Alegra (slug de la cuenta) y id de la lista de Alegra: ids/slug simples, sin espacios.
const CUENTA_ALEGRA_RE = /^[A-Za-z0-9_-]{1,60}$/
const LISTA_ALEGRA_RE = /^[A-Za-z0-9_-]{1,40}$/
export const MAX_CAMBIOS = 50
export const MAX_NOMBRE_LISTA = 60
export const MAX_MARCA = 80
export const COEF_MAX = 100
export const UMBRAL_MAX = 1000

export const MSG_COEF = "El coeficiente debe ser mayor o igual a 1."
export const MSG_COEF_FORMATO = "El coeficiente admite hasta 4 decimales."
export const MSG_NOMBRE = "Ingrese el nombre de la lista."
export const MSG_BODY = "Los datos indicados no son válidos."
export const MSG_SIN_CAMBIOS = "No hay cambios para aplicar."
export const MSG_UMBRAL = "El umbral debe ser un número mayor que 0."
export const MSG_MARCAS_VACIAS = "Seleccione al menos una tarjeta o elija todas."
export const MSG_MARCAS = "Las tarjetas indicadas no son válidas."

export type CambioPrecios =
  | { op: "crearLista"; nombre: string; coeficiente: string; orden?: number; privada?: boolean }
  | {
      op: "editarLista"
      listaId: string
      nombre?: string
      coeficiente?: string
      orden?: number
      activa?: boolean
      /** Lista privada (0068): solo la ven las cuentas corrientes con la lista de Alegra enlazada. */
      privada?: boolean
    }
  | { op: "borrarLista"; listaId: string }
  | { op: "setReferencia"; listaId: string }
  | { op: "upsertOverride"; listaId: string; tipo: "marca"; marca: string; coeficiente: string }
  | { op: "upsertOverride"; listaId: string; tipo: "categoria"; categoriaId: string; coeficiente: string }
  | { op: "borrarOverride"; overrideId: string }
  | { op: "setUmbrales"; confirmacionPct?: string; retencionPct?: string }
  /**
   * Qué lista rige para un medio de pago (y cantidad de cuotas, desde la rebanada D). `listaId` null
   * quita la condición: el medio vuelve a la lista de referencia. `montoMinimo` (numeric como texto,
   * con impuestos) sólo aplica a filas de cuotas: la cantidad se ofrece desde ese total; ausente o
   * null = sin mínimo. `marcas` (0074, ids de marcas-tarjeta.ts) también sólo en cuotas: a qué
   * tarjetas aplica esa cantidad; ausente o null = todas.
   */
  | {
      op: "setCondicion"
      medioSlug: string
      cuotas: number | null
      listaId: string | null
      montoMinimo?: string | null
      marcas?: string[] | null
    }
  /**
   * Enlace "lista de Alegra del contacto -> lista online privada" por cuenta de Alegra (0068).
   * `listaId` null quita el enlace; con valor lo crea o lo mueve a esa lista (que debe ser privada).
   */
  | { op: "setMapeo"; alegraAccount: string; alegraPriceListId: string; listaId: string | null }
  /** SOLO armado por el servidor al revertir una baja; nunca se acepta desde el cliente. */
  | {
      op: "restaurarLista"
      lista: {
        id: string
        nombre: string
        coeficiente: string
        orden: number
        activa: boolean
        esReferencia: boolean
        privada?: boolean
      }
      overrides: { tipo: "marca" | "categoria"; marca: string | null; categoriaId: string | null; coeficiente: string }[]
      mapeos?: { alegraAccount: string; alegraPriceListId: string }[]
    }

export type Invalido = { ok: false; campo: string; error: string }
const invalido = (campo: string, error: string): Invalido => ({ ok: false, campo, error })

/** Monto >= 0 con hasta dos decimales (número o texto) -> texto con dos decimales; null si no es válido. */
function normalizarMonto(v: unknown): string | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return null
    const c = Math.round(v * 100)
    return Math.abs(c - v * 100) > 1e-6 ? null : (c / 100).toFixed(2)
  }
  if (typeof v === "string" && /^\d+(\.\d{1,2})?$/.test(v.trim())) return Number(v.trim()).toFixed(2)
  return null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const esUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v)
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Marca normalizada igual que el SQL: lower(btrim(brand)). */
export const normalizarMarca = (m: string): string => m.trim().toLowerCase()

/**
 * Decimal positivo con hasta `dec` decimales, como string canónico ("1.5" -> "1.5000" con dec=4).
 * Acepta number o string con punto. null si no es un decimal finito.
 */
export function decimalCanonico(v: unknown, dec: number): string | null {
  let s: string
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null
    s = String(v)
    // 1e-7 y similares: no son un decimal "normal".
    if (/e/i.test(s)) return null
  } else if (typeof v === "string") {
    s = v.trim()
  } else return null
  const m = /^(\d{1,6})(?:\.(\d{1,}))?$/.exec(s)
  if (!m) return null
  const frac = m[2] ?? ""
  if (frac.length > dec) {
    // Se tolera ceros de más ("1.50000"); cualquier otro dígito más allá es un formato inválido.
    if (/[1-9]/.test(frac.slice(dec))) return null
  }
  return `${m[1].replace(/^0+(?=\d)/, "")}.${frac.slice(0, dec).padEnd(dec, "0")}`
}

/** true si el decimal canónico es >= 1. */
export const esCoefValido = (c: string): boolean => {
  const n = Number(c)
  return n >= 1 && n <= COEF_MAX
}

function validarCoef(v: unknown, campo: string): { ok: true; coef: string } | Invalido {
  const c = decimalCanonico(v, 4)
  if (c === null) {
    // Vacío, no numérico o negativo => "mayor o igual a 1"; un número válido con demasiados decimales => formato.
    const n = typeof v === "string" ? Number(v.trim() === "" ? Number.NaN : v) : typeof v === "number" ? v : Number.NaN
    return invalido(campo, Number.isFinite(n) && n >= 1 ? MSG_COEF_FORMATO : MSG_COEF)
  }
  if (Number(c) < 1) return invalido(campo, MSG_COEF)
  if (Number(c) > COEF_MAX) return invalido(campo, `El coeficiente no puede superar ${COEF_MAX}.`)
  return { ok: true, coef: c }
}

function validarNombre(v: unknown, campo = "nombre"): { ok: true; nombre: string } | Invalido {
  if (typeof v !== "string" || v.trim() === "") return invalido(campo, MSG_NOMBRE)
  const n = v.trim()
  if (n.length > MAX_NOMBRE_LISTA) return invalido(campo, `El nombre no puede superar los ${MAX_NOMBRE_LISTA} caracteres.`)
  return { ok: true, nombre: n }
}

function validarUmbral(v: unknown, campo: string): { ok: true; pct: string } | Invalido {
  const c = decimalCanonico(v, 2)
  if (c === null || Number(c) <= 0) return invalido(campo, MSG_UMBRAL)
  if (Number(c) > UMBRAL_MAX) return invalido(campo, `El umbral no puede superar ${UMBRAL_MAX} %.`)
  return { ok: true, pct: c }
}

function validarOrden(v: unknown): { ok: true; orden: number } | Invalido {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 9999) {
    return invalido("orden", "El orden indicado no es válido.")
  }
  return { ok: true, orden: v }
}

function validarUno(raw: unknown, i: number): { ok: true; cambio: CambioPrecios } | Invalido {
  const campo = `cambios[${i}]`
  if (!esObjeto(raw) || typeof raw.op !== "string") return invalido(campo, MSG_BODY)
  switch (raw.op) {
    case "crearLista": {
      const n = validarNombre(raw.nombre, `${campo}.nombre`)
      if (!n.ok) return n
      const c = validarCoef(raw.coeficiente, `${campo}.coeficiente`)
      if (!c.ok) return c
      const out: Extract<CambioPrecios, { op: "crearLista" }> = { op: "crearLista", nombre: n.nombre, coeficiente: c.coef }
      if (raw.orden !== undefined) {
        const o = validarOrden(raw.orden)
        if (!o.ok) return o
        out.orden = o.orden
      }
      if (raw.privada !== undefined) {
        if (typeof raw.privada !== "boolean") return invalido(`${campo}.privada`, MSG_BODY)
        out.privada = raw.privada
      }
      return { ok: true, cambio: out }
    }
    case "editarLista": {
      if (!esUuid(raw.listaId)) return invalido(`${campo}.listaId`, MSG_BODY)
      const out: Extract<CambioPrecios, { op: "editarLista" }> = { op: "editarLista", listaId: raw.listaId }
      if (raw.nombre !== undefined) {
        const n = validarNombre(raw.nombre, `${campo}.nombre`)
        if (!n.ok) return n
        out.nombre = n.nombre
      }
      if (raw.coeficiente !== undefined) {
        const c = validarCoef(raw.coeficiente, `${campo}.coeficiente`)
        if (!c.ok) return c
        out.coeficiente = c.coef
      }
      if (raw.orden !== undefined) {
        const o = validarOrden(raw.orden)
        if (!o.ok) return o
        out.orden = o.orden
      }
      if (raw.activa !== undefined) {
        if (typeof raw.activa !== "boolean") return invalido(`${campo}.activa`, MSG_BODY)
        out.activa = raw.activa
      }
      if (raw.privada !== undefined) {
        if (typeof raw.privada !== "boolean") return invalido(`${campo}.privada`, MSG_BODY)
        out.privada = raw.privada
      }
      if (
        out.nombre === undefined &&
        out.coeficiente === undefined &&
        out.orden === undefined &&
        out.activa === undefined &&
        out.privada === undefined
      ) {
        return invalido(campo, MSG_BODY)
      }
      return { ok: true, cambio: out }
    }
    case "borrarLista":
    case "setReferencia": {
      if (!esUuid(raw.listaId)) return invalido(`${campo}.listaId`, MSG_BODY)
      return { ok: true, cambio: { op: raw.op, listaId: raw.listaId } }
    }
    case "upsertOverride": {
      if (!esUuid(raw.listaId)) return invalido(`${campo}.listaId`, MSG_BODY)
      const c = validarCoef(raw.coeficiente, `${campo}.coeficiente`)
      if (!c.ok) return c
      if (raw.tipo === "marca") {
        if (typeof raw.marca !== "string" || normalizarMarca(raw.marca) === "") {
          return invalido(`${campo}.marca`, "Indique la marca.")
        }
        const marca = normalizarMarca(raw.marca)
        if (marca.length > MAX_MARCA) return invalido(`${campo}.marca`, `La marca no puede superar los ${MAX_MARCA} caracteres.`)
        return { ok: true, cambio: { op: "upsertOverride", listaId: raw.listaId, tipo: "marca", marca, coeficiente: c.coef } }
      }
      if (raw.tipo === "categoria") {
        if (!esUuid(raw.categoriaId)) return invalido(`${campo}.categoriaId`, "Seleccione la categoría.")
        return {
          ok: true,
          cambio: { op: "upsertOverride", listaId: raw.listaId, tipo: "categoria", categoriaId: raw.categoriaId, coeficiente: c.coef },
        }
      }
      return invalido(`${campo}.tipo`, "Indique si el ajuste es por marca o por categoría.")
    }
    case "borrarOverride": {
      if (!esUuid(raw.overrideId)) return invalido(`${campo}.overrideId`, MSG_BODY)
      return { ok: true, cambio: { op: "borrarOverride", overrideId: raw.overrideId } }
    }
    case "setUmbrales": {
      const out: Extract<CambioPrecios, { op: "setUmbrales" }> = { op: "setUmbrales" }
      if (raw.confirmacionPct !== undefined) {
        const u = validarUmbral(raw.confirmacionPct, `${campo}.confirmacionPct`)
        if (!u.ok) return u
        out.confirmacionPct = u.pct
      }
      if (raw.retencionPct !== undefined) {
        const u = validarUmbral(raw.retencionPct, `${campo}.retencionPct`)
        if (!u.ok) return u
        out.retencionPct = u.pct
      }
      if (out.confirmacionPct === undefined && out.retencionPct === undefined) return invalido(campo, MSG_BODY)
      return { ok: true, cambio: out }
    }
    case "setCondicion": {
      if (typeof raw.medioSlug !== "string" || !SLUG_MEDIO_RE.test(raw.medioSlug)) {
        return invalido(`${campo}.medioSlug`, "El medio de pago indicado no es válido.")
      }
      let cuotas: number | null = null
      if (raw.cuotas !== undefined && raw.cuotas !== null) {
        if (typeof raw.cuotas !== "number" || !Number.isInteger(raw.cuotas) || raw.cuotas < 2 || raw.cuotas > 24) {
          return invalido(`${campo}.cuotas`, "La cantidad de cuotas debe ser un número entero entre 2 y 24.")
        }
        cuotas = raw.cuotas
      }
      if (raw.listaId !== null && !esUuid(raw.listaId)) return invalido(`${campo}.listaId`, "Seleccione la lista de precios.")
      let montoMinimo: string | null = null
      // Una baja no lleva mínimo: se ignora lo que venga.
      if (raw.listaId !== null && raw.montoMinimo !== undefined && raw.montoMinimo !== null) {
        const m = normalizarMonto(raw.montoMinimo)
        if (m === null) return invalido(`${campo}.montoMinimo`, "Indique un monto válido, igual o mayor que cero.")
        if (cuotas === null) return invalido(`${campo}.montoMinimo`, "El monto mínimo sólo aplica a las cuotas.")
        montoMinimo = m
      }
      let marcas: string[] | null = null
      // Una baja tampoco lleva marcas.
      if (raw.listaId !== null && raw.marcas !== undefined && raw.marcas !== null) {
        const v = raw.marcas
        if (Array.isArray(v) && v.length === 0) return invalido(`${campo}.marcas`, MSG_MARCAS_VACIAS)
        if (!Array.isArray(v) || !v.every(esMarcaValida) || new Set(v).size !== v.length) {
          return invalido(`${campo}.marcas`, MSG_MARCAS)
        }
        if (cuotas === null) return invalido(`${campo}.marcas`, "Las tarjetas sólo se eligen para las cuotas.")
        marcas = ordenarMarcas(v)
      }
      return {
        ok: true,
        cambio: { op: "setCondicion", medioSlug: raw.medioSlug, cuotas, listaId: raw.listaId, montoMinimo, marcas },
      }
    }
    case "setMapeo": {
      if (typeof raw.alegraAccount !== "string" || !CUENTA_ALEGRA_RE.test(raw.alegraAccount)) {
        return invalido(`${campo}.alegraAccount`, "Seleccione la cuenta de Alegra.")
      }
      if (typeof raw.alegraPriceListId !== "string" || !LISTA_ALEGRA_RE.test(raw.alegraPriceListId)) {
        return invalido(`${campo}.alegraPriceListId`, "Seleccione la lista de Alegra.")
      }
      if (raw.listaId !== null && !esUuid(raw.listaId)) return invalido(`${campo}.listaId`, "Seleccione la lista de precios.")
      return {
        ok: true,
        cambio: { op: "setMapeo", alegraAccount: raw.alegraAccount, alegraPriceListId: raw.alegraPriceListId, listaId: raw.listaId },
      }
    }
    default:
      return invalido(campo, MSG_BODY)
  }
}

/** Valida el arreglo `cambios` del body. Un arreglo vacío es inválido (no hay nada que previsualizar). */
export function validarCambios(raw: unknown): { ok: true; cambios: CambioPrecios[] } | Invalido {
  if (!Array.isArray(raw) || raw.length === 0) return invalido("cambios", MSG_SIN_CAMBIOS)
  if (raw.length > MAX_CAMBIOS) return invalido("cambios", `No puede aplicar más de ${MAX_CAMBIOS} cambios a la vez.`)
  const cambios: CambioPrecios[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = validarUno(raw[i], i)
    if (!r.ok) return r
    cambios.push(r.cambio)
  }
  return { ok: true, cambios }
}
