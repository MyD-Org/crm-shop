import type { TenantConfig } from "./tenants"
import { alegraFetch, AlegraHttpError, AlegraRateLimitError } from "./alegra"
import {
  mockBorrarBill,
  mockBuscarBills,
  mockCategoriasContables,
  mockCrearBill,
  mockLeerBill,
  mockListarAlmacenes,
  mockReemplazarLineasBill,
} from "./mock-alegra-compras"

// Cliente Alegra de FACTURAS DE COMPRA (/bills), categorías contables y almacenes, para el change
// `compras-en-transito`. Vive aparte de alegra.ts a propósito (menos conflicto de merge).
//
// Las cuentas de Alegra son REALES (no hay sandbox). Las escrituras de este módulo (`crearBill`,
// `reemplazarLineasBill`, `borrarBill`) SÓLO las debe invocar `compras-service.ts` (aún no existe):
// nunca agregar otro llamador. Las escrituras no se reintentan salvo 429 (un 5xx o un corte
// puede haber aplicado el cambio igual) y llevan timeout propio.
//
// Resultados del sondeo real (MDP, 2026-11-15), que fijan este contrato:
//  - Precios: Alegra conserva 4 decimales en `price` y 4 en `quantity` (qty 1000.123456 -> 1000.1235).
//  - IVA: se calcula SIN redondear por línea (escala 6) y el total se redondea una sola vez, half-up:
//    3 líneas de 10,01 al 21 % dan total 36,34 (por línea daría 36,33). Ver MODELO_IVA_ALEGRA.
//  - GET /bills/{id}: purchases.items y purchases.categories (separados), payments[], retentions[],
//    totalPaid, balance. PUT con purchases reemplaza TODO el bloque (omitir categories quita el tránsito).
//  - Las cuentas de percepciones/retenciones del plan (ids 5036-5046, 5097-5102) las RECHAZA /bills
//    (400, code 11029 «Una de las cuentas contables especificada es inválida»).

/** Cómo calcula Alegra el IVA de una bill (sondeo): sin redondeo por línea, redondeo final half-up. */
export const MODELO_IVA_ALEGRA = "exacto_redondeo_final" as const

/** Timeout de las escrituras: sin él, un corte de Vercel deja el resultado incierto sin control. */
export const TIMEOUT_ESCRITURA_MS = 20_000

export type BillEstado = "open" | "draft" | "closed" | "void" | string

export interface BillLinea {
  tipo: "item" | "cat"
  id: string
  nombre: string | null
  precioCentavos: number
  cantidadMilesimas: number
  taxIds: string[]
}

export interface BillLeida {
  id: string
  estado: BillEstado
  numero: string | null
  proveedorId: string | null
  fecha: string
  vencimiento: string | null
  almacenId: string | null
  observaciones: string | null
  totalCentavos: number
  pagadoCentavos: number
  saldoCentavos: number
  pagos: { id: string; numero: string | null; montoCentavos: number }[]
  retenciones: unknown[]
  lineas: BillLinea[]
  raw: Record<string, unknown>
}

export type BillLineaEscritura = Omit<BillLinea, "nombre">

export interface BillCrearInput {
  proveedorId: string
  numero: string
  fecha: string
  vencimiento: string
  almacenId: string
  observaciones: string
  lineas: BillLineaEscritura[]
}

export interface CategoriaContable {
  id: string
  nombre: string
  tipo: string
  uso: string
}

export type ClaseErrorEscritura = "rechazada" | "no_aplicada" | "incierta"

// ── Conversión de unidades ────────────────────────────────────────────────────────────────────────

const aPesos = (centavos: number) => centavos / 100
const aCantidad = (milesimas: number) => milesimas / 1000
const aCentavos = (pesos: unknown) => Math.round(Number(pesos ?? 0) * 100)
const aMilesimas = (cant: unknown) => Math.round(Number(cant ?? 0) * 1000)
/** Alegra acepta ids numéricos; si no lo son (mock, ids prefijados) se mandan tal cual. */
const idAlegra = (id: string): number | string => (Number.isNaN(Number(id)) ? id : Number(id))

function cuerpoLineas(lineas: BillLineaEscritura[]): { items?: unknown[]; categories?: unknown[] } {
  const mapear = (l: BillLineaEscritura) => ({
    id: idAlegra(l.id),
    price: aPesos(l.precioCentavos),
    quantity: aCantidad(l.cantidadMilesimas),
    ...(l.taxIds.length > 0 ? { tax: l.taxIds.map((t) => ({ id: idAlegra(t) })) } : {}),
  })
  const items = lineas.filter((l) => l.tipo === "item").map(mapear)
  const categories = lineas.filter((l) => l.tipo === "cat").map(mapear)
  return {
    ...(items.length > 0 ? { items } : {}),
    ...(categories.length > 0 ? { categories } : {}),
  }
}

// ── Parseo ────────────────────────────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v))

function parsearLineas(bloque: unknown, tipo: "item" | "cat"): BillLinea[] {
  if (!Array.isArray(bloque)) return []
  return bloque.map((l: Raw) => ({
    tipo,
    id: String(l.id),
    nombre: str(l.name),
    precioCentavos: aCentavos(l.price),
    cantidadMilesimas: aMilesimas(l.quantity),
    taxIds: (Array.isArray(l.tax) ? (l.tax as Raw[]) : []).map((t) => String(t.id)).sort(),
  }))
}

/** Normaliza el JSON crudo de GET /bills/{id}. Pura. */
export function parsearBill(raw: Raw): BillLeida {
  const purchases = (raw.purchases ?? {}) as Raw
  const pagosRaw = Array.isArray(raw.payments) ? (raw.payments as Raw[]) : []
  return {
    id: String(raw.id),
    estado: String(raw.status ?? ""),
    numero: str((raw.numberTemplate as Raw | null)?.fullNumber ?? (raw.numberTemplate as Raw | null)?.number),
    proveedorId: str((raw.provider as Raw | null)?.id),
    fecha: String(raw.date ?? ""),
    vencimiento: str(raw.dueDate),
    almacenId: str((raw.warehouse as Raw | null)?.id),
    observaciones: str(raw.observations),
    totalCentavos: aCentavos(raw.total),
    pagadoCentavos: aCentavos(raw.totalPaid),
    saldoCentavos: aCentavos(raw.balance),
    pagos: pagosRaw.map((p) => ({
      id: String(p.id),
      numero: p.number !== undefined && p.number !== null ? (p.prefix ? `${p.prefix}-${p.number}` : String(p.number)) : null,
      montoCentavos: aCentavos(p.amount),
    })),
    retenciones: Array.isArray(raw.retentions) ? (raw.retentions as unknown[]) : [],
    lineas: [...parsearLineas(purchases.items, "item"), ...parsearLineas(purchases.categories, "cat")],
    raw,
  }
}

// ── Errores ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Qué pasó con una escritura que falló. 4xx (menos 429) = Alegra la rechazó; 429 = no la procesó
 * (se puede reintentar); 5xx, corte de red, timeout o cualquier otra cosa = INCIERTA (pudo
 * aplicarse): hay que reconciliar leyendo la bill, nunca asumir que no pasó.
 */
export function clasificarErrorEscritura(e: unknown): ClaseErrorEscritura {
  if (e instanceof AlegraRateLimitError) return "no_aplicada"
  if (e instanceof AlegraHttpError) return e.status >= 400 && e.status < 500 ? "rechazada" : "incierta"
  return "incierta"
}

const ESCRITURA = { timeoutMs: TIMEOUT_ESCRITURA_MS, reintentos429: 2 } as const

// ── Operaciones ───────────────────────────────────────────────────────────────────────────────────

export async function listarCategoriasContables(config: TenantConfig): Promise<CategoriaContable[]> {
  if (config.alegraMock) return mockCategoriasContables()
  const raw = (await alegraFetch(config, "/categories", { format: "plain" })) as Raw[]
  return (Array.isArray(raw) ? raw : []).map((c) => ({
    id: String(c.id),
    nombre: String(c.name ?? ""),
    tipo: String(c.type ?? ""),
    uso: String(c.use ?? ""),
  }))
}

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()

export const NOMBRE_CATEGORIA_TRANSITO = "Mercadería en tránsito"

/**
 * Resuelve la cuenta contable de tránsito de una cuenta de Alegra: por nombre (tipo asset, sin
 * tildes ni mayúsculas) o por override de id. Pura. Una coincidencia = ok; ninguna o varias sin
 * override = bloquear (quien llama muestra el mensaje en usted).
 */
export function resolverCategoriaTransito(
  cats: CategoriaContable[],
  opts: { nombre?: string; overrideId?: string } = {},
): { ok: true; id: string } | { ok: false; motivo: "no_existe" | "ambigua"; candidatas: string[] } {
  if (opts.overrideId) {
    const existe = cats.some((c) => c.id === opts.overrideId)
    return existe ? { ok: true, id: opts.overrideId } : { ok: false, motivo: "no_existe", candidatas: [] }
  }
  const buscado = normalizar(opts.nombre ?? NOMBRE_CATEGORIA_TRANSITO)
  const candidatas = cats.filter((c) => c.tipo === "asset" && normalizar(c.nombre) === buscado).map((c) => c.id)
  if (candidatas.length === 1) return { ok: true, id: candidatas[0] }
  return candidatas.length === 0 ? { ok: false, motivo: "no_existe", candidatas } : { ok: false, motivo: "ambigua", candidatas }
}

export async function listarAlmacenes(config: TenantConfig): Promise<{ id: string; nombre: string; porDefecto: boolean }[]> {
  if (config.alegraMock) return mockListarAlmacenes()
  const raw = (await alegraFetch(config, "/warehouses")) as Raw[]
  return (Array.isArray(raw) ? raw : []).map((w) => ({
    id: String(w.id),
    nombre: String(w.name ?? ""),
    porDefecto: w.isDefault === true,
  }))
}

/** POST /bills. ESCRITURA REAL: sólo desde compras-service. */
export async function crearBill(config: TenantConfig, input: BillCrearInput): Promise<BillLeida> {
  if (config.alegraMock) return mockCrearBill(input)
  const body = {
    date: input.fecha,
    dueDate: input.vencimiento,
    provider: idAlegra(input.proveedorId),
    numberTemplate: { number: input.numero },
    warehouse: { id: input.almacenId },
    observations: input.observaciones,
    purchases: cuerpoLineas(input.lineas),
  }
  const raw = (await alegraFetch(config, "/bills", undefined, { method: "POST", body }, ESCRITURA)) as Raw
  return parsearBill(raw)
}

/** GET /bills/{id}; 404 = null (borrada). */
export async function leerBill(config: TenantConfig, id: string): Promise<BillLeida | null> {
  if (config.alegraMock) return mockLeerBill(id)
  try {
    const raw = (await alegraFetch(config, `/bills/${encodeURIComponent(id)}`, undefined, undefined, { timeoutMs: TIMEOUT_ESCRITURA_MS })) as Raw
    return parsearBill(raw)
  } catch (e) {
    if (e instanceof AlegraHttpError && e.status === 404) return null
    throw e
  }
}

/**
 * PUT /bills/{id} con SÓLO `purchases` (reemplaza el bloque entero: lo que no se manda se pierde,
 * por eso el llamador reenvía percepciones y demás). ESCRITURA REAL: sólo desde compras-service.
 */
export async function reemplazarLineasBill(config: TenantConfig, id: string, lineas: BillLineaEscritura[]): Promise<BillLeida> {
  if (config.alegraMock) return mockReemplazarLineasBill(id, lineas)
  const raw = (await alegraFetch(
    config,
    `/bills/${encodeURIComponent(id)}`,
    undefined,
    { method: "PUT", body: { purchases: cuerpoLineas(lineas) } },
    ESCRITURA,
  )) as Raw
  return parsearBill(raw)
}

/** DELETE /bills/{id}: 204 = borrada, 404 = ya no existía. Con pagos Alegra responde 400. */
export async function borrarBill(config: TenantConfig, id: string): Promise<"borrada" | "no_existe"> {
  if (config.alegraMock) return mockBorrarBill(id)
  try {
    await alegraFetch(config, `/bills/${encodeURIComponent(id)}`, undefined, { method: "DELETE" }, ESCRITURA)
    return "borrada"
  } catch (e) {
    if (e instanceof AlegraHttpError && e.status === 404) return "no_existe"
    throw e
  }
}

/**
 * Busca bills por número (filtro `number` de Alegra, verificado en el sondeo) y filtra por
 * proveedor y número exacto del lado del CRM: sirve para reconciliar una creación incierta.
 */
export async function buscarBills(config: TenantConfig, q: { proveedorId: string; numero: string }): Promise<BillLeida[]> {
  if (config.alegraMock) return mockBuscarBills(q)
  const raw = (await alegraFetch(config, "/bills", { number: q.numero, limit: "30", start: "0" })) as Raw[]
  return (Array.isArray(raw) ? raw : [])
    .map(parsearBill)
    .filter((b) => b.proveedorId === q.proveedorId && b.numero === q.numero)
}
