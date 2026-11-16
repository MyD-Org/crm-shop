// Validación pura de la entrada de «Nueva compra» (change `compras-en-transito`, S4).
// Convierte pesos -> centavos y cantidades -> milésimas SIN float: sólo acepta valores con los
// decimales que soporta el dominio (2 de costo, 3 de cantidad). Los mensajes van en usted.

export const IVA_SOPORTADOS = [0, 2.5, 5, 10.5, 21, 27] as const

export interface EntradaItem {
  alegraId: string
  cantidadMilesimas: number
  costoCentavos: number
  ivaPorcentaje: number
}

export interface EntradaPercepcion {
  nombre: string
  importeCentavos: number
  certificado: string | null
}

export interface EntradaCompra {
  cuenta: string
  idempotencyKey: string
  proveedor: { id: string; nombre: string; cuit: string | null }
  numeroFactura: string
  fecha: string
  vencimiento: string
  observaciones: string | null
  items: EntradaItem[]
  percepciones: EntradaPercepcion[]
}

export type ResultadoEntrada = { ok: true; value: EntradaCompra } | { ok: false; error: string; campo: string }

const falla = (campo: string, error: string): ResultadoEntrada => ({ ok: false, campo, error })

const MAX_ITEMS = 200
const MAX_PERCEPCIONES = 10
const MAX_CENTAVOS = 10_000_000_000_00 // 10 mil millones de pesos
const MAX_MILESIMAS = 1_000_000_000

/** "12.5" / 12.5 -> 125 con `decimales` = 1 (escala 10^decimales); null si no es exacto. */
function aEscala(valor: unknown, decimales: number): number | null {
  let s: string
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null
    s = String(valor)
  } else if (typeof valor === "string") {
    s = valor.trim().replace(",", ".")
  } else return null
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const [ent, dec = ""] = s.split(".")
  if (dec.length > decimales) return null
  const n = Number(ent + dec.padEnd(decimales, "0"))
  return Number.isSafeInteger(n) ? n : null
}

const esFecha = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "")

export function validarEntradaCompra(raw: unknown): ResultadoEntrada {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return falla("body", "La solicitud no es válida. Revise los datos e inténtelo nuevamente.")
  }
  const b = raw as Record<string, unknown>

  const cuenta = texto(b.cuenta, 60)
  if (!cuenta) return falla("cuenta", "Seleccione la cuenta de Alegra de la compra.")
  const idempotencyKey = texto(b.idempotencyKey, 100)
  if (idempotencyKey.length < 8) return falla("idempotencyKey", "Falta la clave de la operación. Recargue la página e inténtelo nuevamente.")

  const prov = (b.proveedor ?? {}) as Record<string, unknown>
  const provId = texto(prov.id, 60)
  const provNombre = texto(prov.nombre, 200)
  if (!provId || !provNombre) return falla("proveedor", "Seleccione el proveedor de la factura.")
  const provCuit = texto(prov.cuit, 30) || null

  const numeroFactura = texto(b.numeroFactura, 40)
  if (!numeroFactura) return falla("numeroFactura", "Indique el número de la factura del proveedor.")
  if (!esFecha(b.fecha)) return falla("fecha", "Indique la fecha de la factura.")
  if (!esFecha(b.vencimiento)) return falla("vencimiento", "Indique la fecha de vencimiento de la factura.")
  if (b.vencimiento < b.fecha) return falla("vencimiento", "El vencimiento no puede ser anterior a la fecha de la factura.")
  const observaciones = texto(b.observaciones, 500) || null

  if (!Array.isArray(b.items) || b.items.length === 0) return falla("items", "Agregue al menos un producto a la compra.")
  if (b.items.length > MAX_ITEMS) return falla("items", `La compra admite hasta ${MAX_ITEMS} productos.`)
  const items: EntradaItem[] = []
  const vistos = new Set<string>()
  for (const [i, it] of b.items.entries()) {
    const r = (it ?? {}) as Record<string, unknown>
    const pos = `Producto ${i + 1}`
    if ("discount" in r || "descuento" in r) {
      return falla("items", `${pos}: la compra no admite descuentos por línea. Cargue el costo ya con el descuento aplicado.`)
    }
    const alegraId = texto(r.alegraId, 100)
    if (!alegraId) return falla("items", `${pos}: seleccione el producto.`)
    if (vistos.has(alegraId)) return falla("items", `${pos}: el producto está repetido. Sume las cantidades en una sola línea.`)
    vistos.add(alegraId)
    const cant = aEscala(r.cantidad, 3)
    if (cant === null || cant <= 0 || cant > MAX_MILESIMAS) {
      return falla("items", `${pos}: la cantidad debe ser mayor a cero y tener hasta tres decimales.`)
    }
    const costo = aEscala(r.costo, 2)
    if (costo === null || costo < 0 || costo > MAX_CENTAVOS) {
      return falla("items", `${pos}: el costo unitario debe ser un importe de hasta dos decimales, mayor o igual a cero.`)
    }
    const iva = Number(r.ivaPorcentaje)
    if (!(IVA_SOPORTADOS as readonly number[]).includes(iva)) {
      return falla("items", `${pos}: seleccione una alícuota de IVA válida (${IVA_SOPORTADOS.join(", ")} %).`)
    }
    items.push({ alegraId, cantidadMilesimas: cant, costoCentavos: costo, ivaPorcentaje: iva })
  }

  const percepciones: EntradaPercepcion[] = []
  const rawPerc = b.percepciones ?? []
  if (!Array.isArray(rawPerc)) return falla("percepciones", "Las percepciones no son válidas.")
  if (rawPerc.length > MAX_PERCEPCIONES) return falla("percepciones", `La compra admite hasta ${MAX_PERCEPCIONES} percepciones.`)
  const nombres = new Set<string>()
  for (const p of rawPerc) {
    const r = (p ?? {}) as Record<string, unknown>
    const nombre = texto(r.nombre, 120)
    if (!nombre) return falla("percepciones", "Seleccione el tipo de cada percepción.")
    if (nombres.has(nombre)) return falla("percepciones", `La percepción «${nombre}» está repetida. Sume los importes en una sola.`)
    nombres.add(nombre)
    const imp = aEscala(r.importe, 2)
    if (imp === null || imp <= 0 || imp > MAX_CENTAVOS) {
      return falla("percepciones", `Percepción «${nombre}»: el importe debe ser mayor a cero y tener hasta dos decimales.`)
    }
    percepciones.push({ nombre, importeCentavos: imp, certificado: texto(r.certificado, 60) || null })
  }

  return {
    ok: true,
    value: {
      cuenta,
      idempotencyKey,
      proveedor: { id: provId, nombre: provNombre, cuit: provCuit },
      numeroFactura,
      fecha: b.fecha,
      vencimiento: b.vencimiento,
      observaciones,
      items,
      percepciones,
    },
  }
}
