// Datos de envío por producto (tabla `catalog_datos_envio`, migración 0107): peso y medidas de la
// UNIDAD DE VENTA EMBALADA, unidad mínima y unidades por caja master. Sirven para calcular el envío
// más adelante; hoy sólo se ven en el admin, nunca en la tienda.
//
// Este módulo es puro (sin DB): el tipo, la lectura de las filas del índice de un proveedor y los
// textos para mostrar.

export type FuenteDatosEnvio = "coresa" | "manual"

export interface DatosEnvio {
  pesoKg: number | null
  altoCm: number | null
  anchoCm: number | null
  largoCm: number | null
  unidadMinima: number | null
  unidadesPorCaja: number | null
  fuente: FuenteDatosEnvio
  updatedAt?: string
}

/** Número positivo o null: el proveedor usa 0 y "" para "sin dato". Acepta coma decimal. */
export function numeroPositivo(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null
  if (typeof v !== "string") return null
  const t = v.trim().replace(",", ".")
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return n > 0 ? n : null
}

function enteroPositivo(v: unknown): number | null {
  const n = numeroPositivo(v)
  return n !== null && Number.isInteger(n) ? n : null
}

/**
 * "a x b x c" (cm) → { alto, ancho, largo } en el orden en que viene. Admite el sufijo "cm" y
 * convierte "mm". Si falta una medida o alguna es 0, devuelve null entero: media caja no sirve
 * para cotizar.
 */
export function parsearMedidas(texto: unknown): { altoCm: number; anchoCm: number; largoCm: number } | null {
  if (typeof texto !== "string") return null
  const m = texto.trim().toLowerCase().match(/^([\d.,]+)\s*x\s*([\d.,]+)\s*x\s*([\d.,]+)\s*(cm|mm)?$/)
  if (!m) return null
  const factor = m[4] === "mm" ? 0.1 : 1
  const dims = [m[1], m[2], m[3]].map(numeroPositivo)
  if (dims.some((d) => d === null)) return null
  const [alto, ancho, largo] = dims.map((d) => Math.round((d as number) * factor * 100) / 100)
  return { altoCm: alto, anchoCm: ancho, largoCm: largo }
}

/** Fila del índice de productos de Coresa (sólo los campos que usamos). */
export interface FilaCoresa {
  SKU?: unknown
  "Medidas Venta (cm)"?: unknown
  "Peso Venta (kg)"?: unknown
  "Unidad Mínima"?: unknown
  "Caja Master"?: unknown
}

/** Datos de envío de una fila de Coresa; null si la fila no trae ningún dato útil. */
export function datosEnvioDeCoresa(fila: FilaCoresa): DatosEnvio | null {
  const medidas = parsearMedidas(fila["Medidas Venta (cm)"])
  const datos: DatosEnvio = {
    pesoKg: numeroPositivo(fila["Peso Venta (kg)"]),
    altoCm: medidas?.altoCm ?? null,
    anchoCm: medidas?.anchoCm ?? null,
    largoCm: medidas?.largoCm ?? null,
    unidadMinima: enteroPositivo(fila["Unidad Mínima"]),
    unidadesPorCaja: enteroPositivo(fila["Caja Master"]),
    fuente: "coresa",
  }
  const algo = datos.pesoKg !== null || medidas !== null || datos.unidadMinima !== null || datos.unidadesPorCaja !== null
  return algo ? datos : null
}

/** Sufijos de marca que se agregan al código de Coresa en Alegra (RMS-2M-NEG-MCL → RMS-2M-NEG). */
export const SUFIJOS_MARCA_CORESA = ["-MCL", "-CHINT", "-WDM", "-UNV", "-DCK", "-INT", "-KNG", "-PWS"] as const

/** Código de Alegra → SKU de Coresa (sin el sufijo de marca); null si no lleva sufijo de Coresa. */
export function skuCoresaDeCodigo(code: string | null | undefined): string | null {
  if (!code) return null
  const c = code.trim()
  const sufijo = SUFIJOS_MARCA_CORESA.find((s) => c.toUpperCase().endsWith(s))
  if (!sufijo) return null
  const sku = c.slice(0, c.length - sufijo.length).trim()
  return sku || null
}

/** Clave de cruce tolerante a mayúsculas y espacios repetidos. */
export function normalizarSku(sku: string): string {
  return sku.trim().replace(/\s+/g, " ").toUpperCase()
}

const fmt = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 3 })

/** Textos para la ficha del admin. */
export function textosDatosEnvio(d: DatosEnvio): { etiqueta: string; valor: string }[] {
  const medidas =
    d.altoCm !== null && d.anchoCm !== null && d.largoCm !== null
      ? `${fmt(d.altoCm)} × ${fmt(d.anchoCm)} × ${fmt(d.largoCm)} cm`
      : "Sin dato"
  return [
    { etiqueta: "Peso con embalaje", valor: d.pesoKg !== null ? `${fmt(d.pesoKg)} kg` : "Sin dato" },
    { etiqueta: "Medidas con embalaje (alto × ancho × largo)", valor: medidas },
    { etiqueta: "Unidad mínima de venta", valor: d.unidadMinima !== null ? String(d.unidadMinima) : "Sin dato" },
    { etiqueta: "Unidades por caja master", valor: d.unidadesPorCaja !== null ? String(d.unidadesPorCaja) : "Sin dato" },
    { etiqueta: "Origen del dato", valor: d.fuente === "coresa" ? "Datos del proveedor (Coresa)" : "Carga manual" },
  ]
}

export interface PlanCargaCoresa {
  cargar: { alegraId: string; code: string; datos: DatosEnvio }[]
  /** Productos con sufijo de Coresa cuyo SKU no está en el índice. */
  sinMatch: string[]
  /** Productos que cruzan pero la fila de Coresa no trae ningún dato de envío. */
  sinDatos: string[]
  /** SKUs que aparecen más de una vez en el índice con datos distintos: no se cargan. */
  ambiguos: string[]
}

/**
 * Cruza los productos del catálogo (código de Alegra) con el índice de Coresa por SKU (el código sin
 * el sufijo de marca). Puro: el script lo usa para el dry-run y para --aplicar.
 */
export function planearCargaCoresa(
  productos: { alegraId: string; code: string | null }[],
  filas: FilaCoresa[],
): PlanCargaCoresa {
  const porSku = new Map<string, FilaCoresa[]>()
  for (const f of filas) {
    if (typeof f.SKU !== "string" || !f.SKU.trim()) continue
    const k = normalizarSku(f.SKU)
    porSku.set(k, [...(porSku.get(k) ?? []), f])
  }
  const plan: PlanCargaCoresa = { cargar: [], sinMatch: [], sinDatos: [], ambiguos: [] }
  for (const p of productos) {
    const sku = skuCoresaDeCodigo(p.code)
    if (!sku || !p.code) continue
    const candidatas = porSku.get(normalizarSku(sku))
    if (!candidatas) {
      plan.sinMatch.push(p.code)
      continue
    }
    const datos = candidatas.map(datosEnvioDeCoresa)
    const distintos = new Set(datos.map((d) => JSON.stringify(d)))
    if (distintos.size > 1) {
      plan.ambiguos.push(p.code)
      continue
    }
    if (!datos[0]) {
      plan.sinDatos.push(p.code)
      continue
    }
    plan.cargar.push({ alegraId: p.alegraId, code: p.code, datos: datos[0] })
  }
  return plan
}
