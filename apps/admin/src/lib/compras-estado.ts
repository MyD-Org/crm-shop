// Máquina de estados y guardas previas a escribir en Alegra (change `compras-en-transito`). Puro.
import type { BillLeida } from "./alegra-compras"
import { ErrorCompras } from "./compras-dinero"
import { hashSnapshot, normalizarSnapshot } from "./compras-reparto"

export const ESTADOS_COMPRA = [
  "creando",
  "pendiente",
  "parcial",
  "completa",
  "cerrada_faltante",
  "anulada",
  "anulada_en_alegra",
] as const
export type EstadoCompra = (typeof ESTADOS_COMPRA)[number]

const TRANSICIONES: Record<EstadoCompra, readonly EstadoCompra[]> = {
  // 'creando' = fila escrita antes del POST a Alegra; si la bill nunca existió, se descarta como 'anulada'.
  creando: ["pendiente", "anulada"],
  pendiente: ["parcial", "completa", "cerrada_faltante", "anulada", "anulada_en_alegra"],
  parcial: ["parcial", "completa", "cerrada_faltante", "anulada_en_alegra"],
  completa: [],
  cerrada_faltante: [],
  anulada: [],
  anulada_en_alegra: [],
}

export interface ContextoTransicion {
  /** Neto en tránsito que queda (E5). Cerrar con faltante exige que sea > 0. */
  transitoRestanteE5: bigint
}

export function puedeTransitar(desde: EstadoCompra, hacia: EstadoCompra, ctx: ContextoTransicion): boolean {
  if (!TRANSICIONES[desde].includes(hacia)) return false
  if (hacia === "cerrada_faltante" && ctx.transitoRestanteE5 <= BigInt(0)) return false
  return true
}

export function transicionar(desde: EstadoCompra, hacia: EstadoCompra, ctx: ContextoTransicion): EstadoCompra {
  if (!puedeTransitar(desde, hacia, ctx)) {
    throw new ErrorCompras("transicion_invalida", `La compra no puede pasar de «${desde}» a «${hacia}».`)
  }
  return hacia
}

/** Estado de la compra tras aplicar una recepción: completa si no falta nada. */
export function estadoTrasRecepcion(pedidas: number[], recibidas: number[]): "parcial" | "completa" {
  return pedidas.every((p, i) => recibidas[i] >= p) ? "completa" : "parcial"
}

// ── Guardas ───────────────────────────────────────────────────────────────────────────────────────

export interface CompraParaGuardas {
  /** Hash del último estado conocido de las líneas + total de la bill. */
  snapshotHash: string
  /** neto + IVA + percepciones esperado de la compra. */
  totalEsperadoCentavos: number
  almacenId: string
  /** Si queda neto en tránsito, la bill debe seguir teniendo la línea de tránsito. */
  transitoPendiente: boolean
  categoriaTransitoId: string
}

export type ResultadoGuardas = { ok: true } | { ok: false; codigo: string; mensaje: string }

const MSJ_MODIFICADA =
  "La factura cambió en Alegra desde la última vez que se sincronizó. Actualice la compra antes de continuar."

/**
 * Checklist previo a cualquier PUT (D6), en orden fijo; devuelve la primera guarda que falla.
 * `bill` es la lectura en vivo (GET) justo antes de escribir.
 */
export function evaluarGuardas(bill: BillLeida, compra: CompraParaGuardas): ResultadoGuardas {
  if (bill.estado !== "open") {
    return {
      ok: false,
      codigo: "estado_no_abierto",
      mensaje: "La factura ya no está abierta en Alegra. Revise su estado antes de continuar.",
    }
  }
  if (bill.pagos.length > 0) {
    return {
      ok: false,
      codigo: "con_pagos",
      mensaje: "Esta factura ya tiene un pago registrado en Alegra. Registre la recepción directamente en Alegra.",
    }
  }
  if (bill.retenciones.length > 0) {
    return {
      ok: false,
      codigo: "con_retenciones",
      mensaje: "Esta factura tiene retenciones registradas en Alegra. Registre la recepción directamente en Alegra.",
    }
  }
  const hashActual = hashSnapshot(normalizarSnapshot(bill.lineas, bill.totalCentavos))
  if (hashActual !== compra.snapshotHash) {
    return { ok: false, codigo: "modificada_en_alegra", mensaje: MSJ_MODIFICADA }
  }
  if (bill.totalCentavos !== compra.totalEsperadoCentavos) {
    return {
      ok: false,
      codigo: "total_inesperado",
      mensaje: "El total de la factura en Alegra no coincide con el de la compra. Revise la factura en Alegra.",
    }
  }
  if (bill.almacenId !== compra.almacenId) {
    return {
      ok: false,
      codigo: "almacen_distinto",
      mensaje: "El depósito de la factura en Alegra no coincide con el de la compra. Revise la factura en Alegra.",
    }
  }
  if (compra.transitoPendiente && !bill.lineas.some((l) => l.tipo === "cat" && l.id === compra.categoriaTransitoId)) {
    return {
      ok: false,
      codigo: "sin_transito",
      mensaje: "La factura en Alegra ya no tiene la línea de mercadería en tránsito. Revise la factura en Alegra.",
    }
  }
  return { ok: true }
}
