// Reparto del tránsito hacia los ítems recibidos (change `compras-en-transito`). Puro.
//
// La bill de Alegra se crea con UNA línea de «Mercadería en tránsito» por alícuota de IVA. Al
// recibir, cada ítem recibido pasa a ser una línea de ítem con su subtotal exacto
// (costo x cantidad acumulada) y el tránsito de esa alícuota baja en la misma cantidad:
//
//   tránsito_r = N_r − Σ subtotal_exacto(ítems de la alícuota r)      (>= 0, se omite si vale 0)
//
// Como el neto por alícuota es invariante y Alegra suma el IVA exacto (sin redondear por línea) y
// redondea el total una sola vez, el total de la bill no cambia ni un centavo. No hay línea de
// «ajuste por redondeo». Las percepciones NO son líneas de la bill (se aplican con
// PUT /bills/{id}/perceptions y sobreviven al PUT de purchases): sólo suman al total esperado.
import { createHash } from "node:crypto"
import type { BillLineaEscritura } from "./alegra-compras"
import {
  ErrorCompras,
  representarNetoE5,
  subtotalExactoE5,
  totalDeLineasCentavos,
} from "./compras-dinero"

export interface ItemReparto {
  /** Id del ítem en la cuenta de Alegra de la compra (ya resuelto, nunca creado acá). */
  itemIdCuenta: string
  costoCentavos: number
  cantidadPedidaMilesimas: number
  /** Id del impuesto (IVA) de Alegra de la línea. */
  taxId: string
  /** Alícuota en puntos básicos (2100 = 21 %). */
  ivaBp: number
}

/** Alícuota (puntos básicos) por id de impuesto, para calcular totales. */
export function bpPorTax(items: Pick<ItemReparto, "taxId" | "ivaBp">[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const i of items) m[i.taxId] = i.ivaBp
  return m
}

/** Neto exacto (E5) por id de impuesto, ordenado por id. */
export function netoPorAlicuota(items: ItemReparto[]): { taxId: string; netoE5: bigint }[] {
  const m = new Map<string, bigint>()
  for (const i of items) {
    m.set(i.taxId, (m.get(i.taxId) ?? BigInt(0)) + subtotalExactoE5(i.costoCentavos, i.cantidadPedidaMilesimas))
  }
  return [...m.entries()]
    .map(([taxId, netoE5]) => ({ taxId, netoE5 }))
    .sort((a, b) => (a.taxId < b.taxId ? -1 : a.taxId > b.taxId ? 1 : 0))
}

function lineaTransito(categoriaTransitoId: string, taxId: string, netoE5: bigint): BillLineaEscritura {
  const { precioCentavos, cantidadMilesimas } = representarNetoE5(netoE5)
  return { tipo: "cat", id: categoriaTransitoId, precioCentavos, cantidadMilesimas, taxIds: [taxId] }
}

/** Líneas de la bill al crear la compra: sólo tránsito, una por alícuota. */
export function construirLineasCreacion(items: ItemReparto[], categoriaTransitoId: string): BillLineaEscritura[] {
  return construirLineasRecepcion(items, items.map(() => 0), categoriaTransitoId)
}

/**
 * Líneas de la bill dado lo recibido ACUMULADO por ítem (misma posición que `items`): una línea de
 * ítem por cada ítem con algo recibido y una de tránsito por alícuota con saldo. Sin líneas
 * (compra de importe cero) o con sobre-entrega lanza ErrorCompras.
 */
export function construirLineasRecepcion(
  items: ItemReparto[],
  recibidasMilesimas: number[],
  categoriaTransitoId: string,
): BillLineaEscritura[] {
  if (items.length === 0 || recibidasMilesimas.length !== items.length) {
    throw new ErrorCompras("sin_items", "La compra debe tener al menos un ítem.")
  }
  const recibidoE5 = new Map<string, bigint>()
  const lineasItem: BillLineaEscritura[] = []
  items.forEach((it, idx) => {
    const q = recibidasMilesimas[idx]
    if (!Number.isInteger(q) || q < 0 || q > it.cantidadPedidaMilesimas) {
      throw new ErrorCompras(
        "sobre_entrega",
        "La cantidad recibida supera la pendiente. Para mercadería adicional, cargue otra compra.",
      )
    }
    if (q > 0) {
      lineasItem.push({
        tipo: "item",
        id: it.itemIdCuenta,
        precioCentavos: it.costoCentavos,
        cantidadMilesimas: q,
        taxIds: [it.taxId],
      })
      recibidoE5.set(it.taxId, (recibidoE5.get(it.taxId) ?? BigInt(0)) + subtotalExactoE5(it.costoCentavos, q))
    }
  })
  const lineasTransito: BillLineaEscritura[] = []
  for (const { taxId, netoE5 } of netoPorAlicuota(items)) {
    const resto = netoE5 - (recibidoE5.get(taxId) ?? BigInt(0))
    if (resto < BigInt(0)) {
      throw new ErrorCompras("transito_negativo", "El importe recibido supera el importe de la factura.")
    }
    if (resto > BigInt(0)) lineasTransito.push(lineaTransito(categoriaTransitoId, taxId, resto))
  }
  const todas = [...lineasItem, ...lineasTransito]
  if (todas.length === 0) {
    throw new ErrorCompras("compra_sin_importe", "La compra debe tener un importe mayor a cero.")
  }
  return todas
}

/**
 * Total que debe tener la bill (como lo calcula Alegra) = neto + IVA exacto redondeado una vez +
 * percepciones. No depende de cuánto se recibió (es el invariante).
 */
export function totalEsperadoCentavos(items: ItemReparto[], percepcionesCentavos: number[]): number {
  const lineas = construirLineasCreacion(items, "transito")
  const bill = totalDeLineasCentavos(lineas, bpPorTax(items))
  return bill + percepcionesCentavos.reduce((a, p) => a + p, 0)
}

/**
 * Valida una recepción nueva contra lo ya recibido y devuelve el ACUMULADO por ítem.
 * `nuevas` y `previas` en milésimas, misma posición que `items`.
 */
export function validarRecepcion(items: ItemReparto[], previas: number[], nuevas: number[]): number[] {
  if (nuevas.length !== items.length || previas.length !== items.length) {
    throw new ErrorCompras("recepcion_invalida", "La recepción no coincide con los ítems de la compra.")
  }
  for (const n of nuevas) {
    if (!Number.isInteger(n) || n < 0) {
      throw new ErrorCompras(
        "cantidad_invalida",
        "Las cantidades recibidas deben ser mayores o iguales a cero y tener hasta tres decimales.",
      )
    }
  }
  if (nuevas.every((n) => n === 0)) {
    throw new ErrorCompras("sin_cantidades", "Indique al menos una cantidad recibida.")
  }
  return items.map((it, i) => {
    const acumulado = previas[i] + nuevas[i]
    if (acumulado > it.cantidadPedidaMilesimas) {
      throw new ErrorCompras(
        "sobre_entrega",
        "La cantidad recibida supera la pendiente. Para mercadería adicional, cargue otra compra.",
      )
    }
    return acumulado
  })
}

// ── Snapshot y hash ───────────────────────────────────────────────────────────────────────────────

export interface SnapshotBill {
  totalCentavos: number
  lineas: { tipo: "item" | "cat"; id: string; precioCentavos: number; cantidadMilesimas: number; taxIds: string[] }[]
}

/** Forma canónica de las líneas (sin nombres, taxIds y líneas ordenados) + total. */
export function normalizarSnapshot(
  lineas: Pick<BillLineaEscritura, "tipo" | "id" | "precioCentavos" | "cantidadMilesimas" | "taxIds">[],
  totalCentavos: number,
): SnapshotBill {
  const norm = lineas.map((l) => ({
    tipo: l.tipo,
    id: String(l.id),
    precioCentavos: l.precioCentavos,
    cantidadMilesimas: l.cantidadMilesimas,
    taxIds: [...l.taxIds].map(String).sort(),
  }))
  norm.sort((a, b) => {
    const ka = [a.tipo, a.id, a.taxIds.join(","), String(a.precioCentavos).padStart(20, "0"), String(a.cantidadMilesimas).padStart(20, "0")].join("|")
    const kb = [b.tipo, b.id, b.taxIds.join(","), String(b.precioCentavos).padStart(20, "0"), String(b.cantidadMilesimas).padStart(20, "0")].join("|")
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  return { totalCentavos, lineas: norm }
}

/** sha256 hex del JSON canónico del snapshot (claves en orden fijo). */
export function hashSnapshot(s: SnapshotBill): string {
  const canonico = JSON.stringify({
    totalCentavos: s.totalCentavos,
    lineas: s.lineas.map((l) => [l.tipo, l.id, l.precioCentavos, l.cantidadMilesimas, l.taxIds]),
  })
  return createHash("sha256").update(canonico).digest("hex")
}
