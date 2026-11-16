// Dinero del módulo Compras (change `compras-en-transito`). Puro: sin red ni DB.
//
// Unidades:
//  - Importes de dominio y de DB: CENTAVOS enteros (`number`, hasta 2^53).
//  - Cantidades: MILÉSIMAS enteras (1,5 m = 1500).
//  - Subtotal exacto de una línea = precio_centavos x cantidad_milésimas = CIENMILÉSIMAS de peso
//    ("E5", `bigint`): 1 peso = 100_000. Alegra NO redondea por línea (sondeo MDP 2026-11-15), así
//    que para que el total no cambie ni un centavo el reparto trabaja en E5 exacto.

/** Cómo calcula Alegra el total de una bill (sondeo): IVA exacto, un solo redondeo half-up al final. */
export const MODELO_IVA = "exacto_redondeo_final" as const

/** Error de dominio con mensaje apto para mostrar (español formal de usted). */
export class ErrorCompras extends Error {
  readonly codigo: string
  constructor(codigo: string, mensaje: string) {
    super(mensaje)
    this.name = "ErrorCompras"
    this.codigo = codigo
  }
}

const E5_POR_CENTAVO = BigInt(1000)
const E9_CENTAVO = BigInt(10_000_000) // un centavo en la escala 1e-9
const MAX_SEGURO = BigInt(Number.MAX_SAFE_INTEGER)

export function validarCostoCentavos(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new ErrorCompras("costo_invalido", "El costo unitario debe ser un importe de hasta dos decimales, mayor o igual a cero.")
  }
  return n
}

export function validarCantidadMilesimas(n: number): number {
  if (!Number.isInteger(n) || n <= 0) {
    throw new ErrorCompras("cantidad_invalida", "La cantidad debe ser mayor a cero y tener hasta tres decimales.")
  }
  return n
}

/** Subtotal exacto de una línea, en cienmilésimas de peso. */
export function subtotalExactoE5(costoCentavos: number, cantidadMilesimas: number): bigint {
  return BigInt(costoCentavos) * BigInt(cantidadMilesimas)
}

/** E5 -> centavos, half-up. Sólo para mostrar: el reparto usa E5. */
export function e5ACentavos(e5: bigint): number {
  return Number((e5 + E5_POR_CENTAVO / BigInt(2)) / E5_POR_CENTAVO)
}

/** Subtotal de una línea redondeado a centavos (half-up). */
export function subtotalCentavos(costoCentavos: number, cantidadMilesimas: number): number {
  return e5ACentavos(subtotalExactoE5(costoCentavos, cantidadMilesimas))
}

/** 21 -> 2100, 10.5 -> 1050 (puntos básicos). */
export function ivaBpDePorcentaje(porcentaje: number): number {
  return Math.round(porcentaje * 100)
}

export interface LineaParaTotal {
  precioCentavos: number
  cantidadMilesimas: number
  taxIds: string[]
}

/**
 * Total de una bill como lo calcula Alegra: Σ subtotal + Σ IVA exacto, redondeado a centavos
 * half-up UNA vez. `bpPorTax` mapea el id del impuesto a su alícuota en puntos básicos; un id
 * desconocido no suma IVA.
 */
export function totalDeLineasCentavos(lineas: LineaParaTotal[], bpPorTax: Record<string, number>): number {
  let total = BigInt(0) // escala 1e-9
  for (const l of lineas) {
    const sub = BigInt(l.precioCentavos) * BigInt(l.cantidadMilesimas) // 1e-5
    total += sub * BigInt(10_000)
    for (const t of l.taxIds) total += sub * BigInt(bpPorTax[t] ?? 0) // 1e-5 x bp(1e-4) = 1e-9
  }
  return Number((total + E9_CENTAVO / BigInt(2)) / E9_CENTAVO)
}

/** Centavos -> pesos (único punto de conversión hacia el body de Alegra). */
export function aPesos(centavos: number): number {
  return centavos / 100
}

/**
 * Cómo escribir un neto exacto positivo (E5) como UNA línea de Alegra (precio en centavos enteros
 * x cantidad en milésimas, el contrato de alegra-compras.ts). Si es múltiplo de centavo: precio x 1.
 * Si no (cantidades fraccionarias con centavos impares): 1 centavo x cantidad fraccionaria, que
 * reproduce el neto exacto.
 */
export function representarNetoE5(netoE5: bigint): { precioCentavos: number; cantidadMilesimas: number } {
  if (netoE5 <= BigInt(0)) {
    throw new ErrorCompras("neto_invalido", "El importe en tránsito debe ser mayor a cero.")
  }
  if (netoE5 > MAX_SEGURO) {
    throw new ErrorCompras("neto_fuera_de_rango", "El importe de la compra es demasiado grande.")
  }
  if (netoE5 % E5_POR_CENTAVO === BigInt(0)) {
    return { precioCentavos: Number(netoE5 / E5_POR_CENTAVO), cantidadMilesimas: 1000 }
  }
  return { precioCentavos: 1, cantidadMilesimas: Number(netoE5) }
}
