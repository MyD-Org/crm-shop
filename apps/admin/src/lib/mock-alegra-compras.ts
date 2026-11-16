import { AlegraHttpError, AlegraRateLimitError } from "./alegra"
import type { BillCrearInput, BillLeida, BillLinea, BillLineaEscritura, CategoriaContable, PercepcionEscritura } from "./alegra-compras"

// Mock en memoria de /bills para tests y modo `alegraMock`. Replica lo verificado contra Alegra
// real (sondeo MDP 2026-11-15): PUT reemplaza el bloque purchases entero; el IVA se calcula SIN
// redondear por línea y el total se redondea una sola vez, half-up (MODELO_IVA_ALEGRA); DELETE
// con pagos falla; el stock no se modela. Los ids de tax siguen el catálogo de Alegra Argentina.

/** Alícuotas por id de tax, en puntos básicos (21,00 % = 2100). Catálogo de Alegra AR. */
const TAX_BP: Record<string, number> = { "1": 2100, "2": 2700, "3": 1050, "4": 0 }

/**
 * Total de una bill como lo calcula Alegra: Σ subtotal + Σ IVA exacto, redondeado a centavos
 * half-up UNA vez. Escala interna 1e-9 peso con BigInt (centavos × milésimas × bp).
 */
export function calcularTotalBillCentavos(lineas: Pick<BillLinea, "precioCentavos" | "cantidadMilesimas" | "taxIds">[]): number {
  let total = BigInt(0) // en 1e-9 peso
  for (const l of lineas) {
    const sub = BigInt(l.precioCentavos) * BigInt(l.cantidadMilesimas) // 1e-5 peso
    total += sub * BigInt(10_000) // 1e-9
    for (const t of l.taxIds) total += sub * BigInt(TAX_BP[t] ?? 0) // sub(1e-5) × bp(1e-4) = 1e-9
  }
  const CENTAVO = BigInt(10_000_000) // 1e-2 en escala 1e-9
  return Number((total + CENTAVO / BigInt(2)) / CENTAVO)
}

interface BillMock {
  id: string
  estado: string
  numero: string
  proveedorId: string
  fecha: string
  vencimiento: string
  almacenId: string
  observaciones: string
  lineas: BillLinea[]
  pagos: { id: string; numero: string | null; montoCentavos: number }[]
  retenciones: unknown[]
  percepciones: PercepcionEscritura[]
}

const bills = new Map<string, BillMock>()
let siguienteId = 9001
let siguientePago = 8001
let fallo: FalloMock | null = null

export interface FalloMock {
  tras: "put" | "post" | "delete" | "percepciones"
  modo: "5xx" | "corte" | "429"
}

/**
 * Inyecta UN fallo en la próxima operación indicada. '5xx' y 'corte' dejan la operación APLICADA
 * y después lanzan (resultado incierto, el caso difícil); '429' lanza antes de aplicar.
 */
export function __mockBillsFallar(f: FalloMock): void {
  fallo = f
}

export function __mockBillsReset(): void {
  bills.clear()
  siguienteId = 9001
  siguientePago = 8001
  fallo = null
}

/** Simula un pago hecho en Alegra sobre la bill (para probar las guardas). */
export function __mockBillsAgregarPago(id: string, montoCentavos: number): void {
  const b = bills.get(id)
  if (!b) throw new Error(`mock: bill ${id} no existe`)
  b.pagos.push({ id: String(siguientePago++), numero: null, montoCentavos })
}

/** Simula una edición externa de las líneas (para probar el snapshot). */
export function __mockBillsEditarExterno(id: string, lineas: BillLineaEscritura[]): void {
  const b = bills.get(id)
  if (!b) throw new Error(`mock: bill ${id} no existe`)
  b.lineas = lineas.map((l) => ({ ...l, nombre: null }))
}

/** Borra una bill sin pasar por la API (simula borrado externo). */
export function __mockBillsBorrarExterno(id: string): void {
  bills.delete(id)
}

function antes(op: FalloMock["tras"]): void {
  if (fallo?.tras === op && fallo.modo === "429") {
    fallo = null
    throw new AlegraRateLimitError(`/bills (mock ${op})`, "")
  }
}

function despues(op: FalloMock["tras"]): void {
  if (fallo?.tras !== op) return
  const modo = fallo.modo
  fallo = null
  if (modo === "5xx") throw new AlegraHttpError(500, `/bills (mock ${op})`, "error interno simulado")
  throw new TypeError("fetch failed")
}

function aLeida(b: BillMock): BillLeida {
  const total = calcularTotalBillCentavos(b.lineas) + b.percepciones.reduce((a, p) => a + p.importeCentavos, 0)
  const pagado = b.pagos.reduce((a, p) => a + p.montoCentavos, 0)
  return {
    id: b.id,
    estado: b.estado,
    numero: b.numero,
    proveedorId: b.proveedorId,
    fecha: b.fecha,
    vencimiento: b.vencimiento,
    almacenId: b.almacenId,
    observaciones: b.observaciones,
    totalCentavos: total,
    pagadoCentavos: pagado,
    saldoCentavos: total - pagado,
    pagos: b.pagos.map((p) => ({ ...p })),
    retenciones: [...b.retenciones],
    lineas: b.lineas.map((l) => ({ ...l, taxIds: [...l.taxIds] })),
    raw: {},
  }
}

const sinNombre = (l: BillLineaEscritura): BillLinea => ({ ...l, nombre: null, taxIds: [...l.taxIds].sort() })

export function mockCrearBill(input: BillCrearInput): BillLeida {
  antes("post")
  const dup = [...bills.values()].find((b) => b.proveedorId === input.proveedorId && b.numero === input.numero)
  if (dup) throw new AlegraHttpError(400, "/bills (mock)", "El número de factura ya existe para el proveedor")
  const b: BillMock = {
    id: String(siguienteId++),
    estado: "open",
    numero: input.numero,
    proveedorId: input.proveedorId,
    fecha: input.fecha,
    vencimiento: input.vencimiento,
    almacenId: input.almacenId,
    observaciones: input.observaciones,
    lineas: input.lineas.map(sinNombre),
    pagos: [],
    retenciones: [],
    percepciones: [],
  }
  bills.set(b.id, b)
  despues("post")
  return aLeida(b)
}

export function mockLeerBill(id: string): BillLeida | null {
  const b = bills.get(id)
  return b ? aLeida(b) : null
}

export function mockReemplazarLineasBill(id: string, lineas: BillLineaEscritura[]): BillLeida {
  antes("put")
  const b = bills.get(id)
  if (!b) throw new AlegraHttpError(404, `/bills/${id} (mock)`, "no existe")
  b.lineas = lineas.map(sinNombre)
  despues("put")
  return aLeida(b)
}

export function mockBorrarBill(id: string): "borrada" | "no_existe" {
  antes("delete")
  const b = bills.get(id)
  if (!b) return "no_existe"
  // Alegra real: DELETE de una bill con pagos responde 400 genérico.
  if (b.pagos.length > 0) throw new AlegraHttpError(400, `/bills/${id} (mock)`, "Ha ocurrido un error")
  bills.delete(id)
  despues("delete")
  return "borrada"
}

export function mockBuscarBills(q: { proveedorId: string; numero: string }): BillLeida[] {
  return [...bills.values()].filter((b) => b.proveedorId === q.proveedorId && b.numero === q.numero).map(aLeida)
}

export function mockCategoriasContables(): CategoriaContable[] {
  return [
    { id: "5147", nombre: "Costos de la mercadería vendida", tipo: "cost", uso: "movement" },
    { id: "5246", nombre: "Mercadería en tránsito", tipo: "asset", uso: "movement" },
  ]
}

export function mockListarAlmacenes(): { id: string; nombre: string; porDefecto: boolean }[] {
  return [{ id: "wh-mock-1", nombre: "Principal", porDefecto: true }]
}

/** El total de la bill incluye las percepciones; el PUT de `purchases` las conserva. */
export function mockReemplazarPercepcionesBill(id: string, percepciones: PercepcionEscritura[]): void {
  antes("percepciones")
  const b = bills.get(id)
  if (!b) throw new AlegraHttpError(404, `/bills/${id}/perceptions (mock)`, "no existe")
  b.percepciones = percepciones.map((p) => ({ ...p }))
  despues("percepciones")
}
