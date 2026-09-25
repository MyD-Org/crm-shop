import type { TenantConfig } from "./tenants"
import { sumaImpuestos } from "./alegra-impuestos"
import {
  mockCategories,
  mockItems,
  getMockItemLive,
  mockContacts,
  mockPriceLists,
  mockPaymentTerms,
  mockSellers,
  mockTaxes,
  mockCurrencies,
  mockCreateEstimate,
  mockDeleteEstimate,
  mockListEstimates,
  mockInvoicesByContact,
  mockAllInvoices,
  mockPaymentsByContact,
} from "./mock-alegra"

// Cliente de Alegra (productos, contactos, cotizaciones, listas de precio, formas de pago).
// Auth HTTP Basic (email:token). Espejo del patrón de lib/flexxus.ts. Modo mock (alegraMock)
// usa fixtures locales — permite construir/probar sin credenciales. Ver ADR catálogo Alegra.
//
// OJO: las cuentas de Alegra son REALES (no hay sandbox). Las lecturas son inocuas; las
// escrituras deliberadas son cotizaciones (/estimates, borrables por API) y pagos (/payments,
// decisión explícita del backoffice de comprobantes: el admin carga el cobro real del
// cliente, imputado a facturas abiertas). No exponer creación de facturas desde acá.

const ALEGRA_BASE = process.env.ALEGRA_BASE_URL ?? "https://api.alegra.com/api/v1"
const PAGE_SIZE = 30 // Alegra topea limit en 30

// ── Tipos normalizados (lo que consume la sync / el live), independientes del shape crudo ──
export interface AlegraCategory {
  alegraId: string
  name: string
  parentAlegraId: string | null
  status: string
}
export interface AlegraPrice {
  idPriceList: string
  name: string
  price: number
}
export interface AlegraProduct {
  alegraId: string
  code: string | null
  name: string
  description: string | null
  categoryAlegraId: string | null
  prices: AlegraPrice[]
  stock: number | null
  /** Estado que Alegra le pone al ítem. NO confundir con el `status` del espejo, que es "visto en la última corrida". */
  status: string
  images: string[]
  /** Marca. No es nativa de Alegra: sale de customFields. */
  brand: string | null
  /** Alícuota de IVA del ítem, para el precio final. */
  ivaPorcentaje: number | null
  /** El ítem COMPLETO tal cual vino. Nada se descarta. */
  raw: Record<string, unknown>
}
export interface AlegraContact {
  alegraId: string
  name: string
  identification: string | null // CUIT/DNI según el país de la cuenta
  email: string | null
  phone: string | null
  priceListId: string | null
  sellerId: string | null
  paymentTermId: string | null
  status: string
  // ── Información comercial ("Información comercial" en la ficha del contacto en Alegra).
  // Vienen embebidos en /contacts, sin requests extra. Cualquiera puede faltar: en la cuenta
  // de Avantec el plazo está en 90 de 107 contactos, la lista en 17, el vendedor en 3 y el
  // límite de crédito en 5. Por eso son todos nullable y la UI esconde lo vacío.
  /** Ej. "15 días", "De contado". */
  paymentTermName: string | null
  paymentTermDays: number | null
  priceListName: string | null
  sellerName: string | null
  /** `null` = no cargado. Distinto de 0, que sería "sin crédito" puesto a propósito. */
  creditLimit: number | null
}
export interface AlegraContactInput {
  name: string
  identification?: string // CUIT/DNI
  email?: string
  phone?: string
}
export interface AlegraPriceList {
  alegraId: string
  name: string
  type: string | null // percentage | amount | ...
  status: string
}
export interface AlegraPaymentTerm {
  alegraId: string
  name: string
  days: number | null
}
export interface AlegraSeller {
  alegraId: string
  name: string
  identification: string | null
  status: string
}
export interface AlegraTax {
  alegraId: string
  name: string
  percentage: number | null
  status: string
}
export interface AlegraCurrency {
  code: string
  name: string
  symbol: string | null
  exchangeRate: number | null
}
export interface AlegraEstimateItemInput {
  alegraId: string
  quantity: number
  price?: number // si no viene, Alegra usa el precio del ítem (según lista del cliente)
  discount?: number // porcentaje
}
export interface AlegraEstimateInput {
  contactAlegraId: string
  items: AlegraEstimateItemInput[]
  dueDate?: string // YYYY-MM-DD
  observations?: string
  anotation?: string // nota interna, no visible al cliente
  priceListId?: string
  sellerId?: string
}
export interface AlegraEstimate {
  alegraId: string
  number: string | null
  date: string
  dueDate: string | null
  clientAlegraId: string
  clientName: string
  status: string
  total: number
  observations: string | null
  items: { alegraId: string; name: string; quantity: number; price: number; discount: number }[]
}
export interface AlegraInvoice {
  alegraId: string
  number: string | null // fullNumber legible (ej. "FV-1-00012876") si Alegra lo trae
  date: string // emisión, YYYY-MM-DD
  dueDate: string | null // vencimiento, YYYY-MM-DD
  total: number
  balance: number // saldo pendiente (0 = pagada)
  status: string // Alegra: open | closed | draft | void
  clientAlegraId: string
}
export interface AlegraPaymentApplied {
  invoiceAlegraId: string
  invoiceNumber: string | null
  amount: number
}
export interface AlegraPayment {
  alegraId: string
  number: string | null
  date: string // YYYY-MM-DD
  amount: number
  method: string // paymentMethod (Transferencia, Efectivo, ...)
  invoices: AlegraPaymentApplied[]
}
/** Saldo de cuenta corriente derivado de las facturas abiertas del contacto. */
export interface AlegraContactBalance {
  total: number // deuda total (saldo de facturas open)
  overdue: number // vencido (dueDate < hoy)
  toFallDue: number // a vencer
}

// ── Pagos: escritura real (backoffice de comprobantes) ──────────────────────
// Hasta acá la única escritura era /estimates (borrable). Crear pagos es la excepción
// deliberada del backoffice de comprobantes: el admin revisa el comprobante del cliente y
// carga el cobro REAL en Alegra, imputado a facturas abiertas. Ver docs/pagos de Alegra:
//   POST   /payments                → { client: {id}, date, paymentMethod, bankAccount,
//                                       invoices: [{id, amount}], observations (≤500) }
//   POST   /payments/{id}/attachment → multipart, campo `file`, un solo archivo, tope 2 MB.

/** Métodos de pago que acepta Alegra (paymentMethod, tope 15 chars). */
export const ALEGRA_PAYMENT_METHODS = ["transfer", "cash", "deposit", "check", "credit-card", "debit-card"] as const
export type AlegraPaymentMethod = (typeof ALEGRA_PAYMENT_METHODS)[number]

/** Tope de adjunto de la API de Alegra (POST /payments/{id}/attachment): 2 MB por archivo. */
export const ALEGRA_ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024

export interface AlegraBankAccount {
  alegraId: string
  name: string
  type: string | null // bank | cash | credit-card
  status: string
}

export interface AlegraPaymentCreateInput {
  contactAlegraId: string
  /** "YYYY-MM-DD". */
  date: string
  paymentMethod: AlegraPaymentMethod
  bankAccountId?: string
  invoices: { alegraId: string; amount: number }[]
  /** Observaciones del pago: NO visibles en el documento impreso (tope 500 en Alegra). */
  notes?: string
}

export interface AlegraPaymentCreated {
  alegraId: string
  /** Número del recibo de caja en Alegra, o null si la cuenta no numeró el pago. */
  number: string | null
}

function authHeader(config: TenantConfig): string {
  const basic = Buffer.from(`${config.alegraEmail}:${config.alegraToken}`).toString("base64")
  return `Basic ${basic}`
}

/**
 * Alegra contestó 429 (límite de requests por minuto) y los reintentos no alcanzaron.
 *
 * Tiene tipo propio para que quien llama pueda distinguir "el ERP nos está frenando"
 * (transitorio, se reintenta más tarde) de un error real de datos, y contestarle al
 * usuario algo mejor que "Error interno del servidor".
 */
export class AlegraRateLimitError extends Error {
  readonly status = 429
  constructor(path: string, detail: string) {
    super(`Alegra rate limit (429) en ${path}${detail ? `: ${detail.slice(0, 300)}` : ""}`)
    this.name = "AlegraRateLimitError"
  }
}

/**
 * Alegra contestó un status de error que no es 429. `status` permite distinguir un 404
 * ("no existe") de una caída sin parsear el mensaje, que queda igual que antes.
 */
export class AlegraHttpError extends Error {
  constructor(
    readonly status: number,
    path: string,
    detail: string,
  ) {
    super(`Alegra error ${status} en ${path}${detail ? `: ${detail.slice(0, 300)}` : ""}`)
    this.name = "AlegraHttpError"
  }
}

// Alegra limita por requests/minuto y devuelve 429 sin avisar de antemano. Los listados
// que paginan en paralelo (PAGE_CONCURRENCY) lo tocan fácil, y antes un solo 429 en
// cualquier página tiraba toda la operación. Se reintenta esa request sola, con espera
// creciente y respetando Retry-After si viene.
const RATE_LIMIT_RETRIES = 5
const RATE_LIMIT_BASE_DELAY_MS = 1000

/**
 * Techo de la espera, para que un `Retry-After` exagerado no se coma el presupuesto de la
 * corrida. El techo viejo de 10s era demasiado corto en el otro sentido: se gastaban los tres
 * intentos dentro de la misma ventana que acababa de rechazar el pedido.
 */
const RATE_LIMIT_MAX_DELAY_MS = 30_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Cuánto esperar antes de reintentar, en milisegundos.
 *
 * Respeta `Retry-After` si viene; si no, espera creciente. En los dos casos suma **jitter**, que
 * es lo que faltaba: al paginar en tandas paralelas, un 429 lo reciben las N requests de la tanda
 * a la vez, y sin jitter las N esperan exactamente lo mismo y vuelven a chocar todas juntas
 * contra la misma ventana. El jitter las desparrama.
 *
 * Pura y exportada para poder probarla: es la decisión que hacía fallar la sync del catálogo
 * grande todos los días.
 */
export function esperaDeReintento(
  attempt: number,
  retryAfterHeader: string | null,
  random: () => number = Math.random,
): number {
  const secs = retryAfterHeader ? Number(retryAfterHeader) : NaN
  const base =
    Number.isFinite(secs) && secs > 0
      ? Math.min(secs * 1000, RATE_LIMIT_MAX_DELAY_MS)
      : Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt, RATE_LIMIT_MAX_DELAY_MS)
  // Hasta un 50% extra, nunca menos que la base: esperar de menos volvería a chocar.
  return Math.round(base * (1 + random() * 0.5))
}

/**
 * ¿Es un límite de requests disfrazado? `/contacts` tiene un tope propio (~5 requests por
 * minuto, probado 2026-09-23 contra la cuenta real; `/items` no lo tiene) y cuando se pasa NO
 * responde 429: responde **400** con el 429 en el body, `{"code":429,"message":"Too many
 * requests",...}`. Tomarlo como un 400 común hacía que el login del portal probara el filtro
 * siguiente y le dijera al cliente "No encontramos una cuenta" con Alegra saturado, y que la
 * sync de contactos cortara en la 6ª página.
 */
export function esLimiteDisfrazado(status: number, body: string): boolean {
  if (status !== 400 || !body) return false
  try {
    const j = JSON.parse(body) as { code?: unknown }
    return Number(j?.code) === 429
  } catch {
    return false
  }
}

async function alegraFetch(
  config: TenantConfig,
  path: string,
  params?: Record<string, string>,
  init?: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown },
  extra: {
    // Se llama antes de CADA request HTTP, reintentos por 429 incluidos: es lo que se lleva
    // la cuota. Lo usa la sync de contactos para registrar su presupuesto.
    onRequest?: () => void
    // Cuántas veces reintentar un 429 antes de tirar AlegraRateLimitError. La sync de
    // contactos pasa 0: prefiere cortar el tramo y seguir en la próxima invocación antes que
    // gastar en reintentos las pocas requests por minuto que /contacts les deja al portal y
    // al bot.
    reintentos429?: number
  } = {},
) {
  const { onRequest } = extra
  const reintentos429 = extra.reintentos429 ?? RATE_LIMIT_RETRIES
  const url = new URL(`${ALEGRA_BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  for (let attempt = 0; ; attempt++) {
    onRequest?.()
    const res = await fetch(url.toString(), {
      method: init?.method ?? "GET",
      headers: {
        Authorization: authHeader(config),
        Accept: "application/json",
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    })

    // El 400 se lee acá para poder distinguir el límite disfrazado (ver esLimiteDisfrazado).
    const detail400 = res.status === 400 ? await res.text().catch(() => "") : null
    if (res.status === 429 || (detail400 !== null && esLimiteDisfrazado(400, detail400))) {
      const detail = detail400 ?? (await res.text().catch(() => ""))
      if (attempt < reintentos429) {
        await sleep(esperaDeReintento(attempt, res.headers.get("retry-after")))
        continue
      }
      throw new AlegraRateLimitError(path, detail)
    }

    if (!res.ok) {
      // Alegra devuelve el motivo en el body (ej. validación de la cotización) — lo sumamos al error.
      const detail = detail400 ?? (await res.text().catch(() => ""))
      throw new AlegraHttpError(res.status, path, detail)
    }
    if (res.status === 204) return null
    return res.json()
  }
}

// Pagina un endpoint de Alegra (start/limit) hasta agotar, mapeando cada fila a un tipo normalizado.
// Alegra topea el limit en 30/página. Para catálogos grandes, pedir una página a la vez
// (await secuencial) tarda demasiado y hace que la función serverless llegue al timeout
// (504 Vercel Runtime Timeout, visto con el catálogo de Central Led). Se piden varias
// páginas en paralelo por tanda para bajar el tiempo total de wall-clock.
// 8 hacía que Alegra respondiera 429 y la sync diaria de Central Led (~5959 items ≈ 199 páginas)
// fallara ENTERA todos los días, mientras la de Avantec (1715 ≈ 58 páginas) pasaba sin problema:
// no era un problema de credenciales sino de volumen contra el límite por minuto.
//
// 4 es el mismo valor al que llegó el Shop el 13/09/2026 contra esta misma cuenta, por el mismo
// motivo. La corrida tarda unos minutos, que no es un problema porque la sync corre en GitHub
// Actions y no tiene el techo de 300 s de la función.
const PAGE_CONCURRENCY = 4


async function fetchAllPages<T>(
  config: TenantConfig,
  path: string,
  map: (raw: Record<string, unknown>) => T,
  extraParams: Record<string, string> = {},
): Promise<T[]> {
  const out: T[] = []
  let start = 0
  let done = false
  while (!done) {
    const starts = Array.from({ length: PAGE_CONCURRENCY }, (_, i) => start + i * PAGE_SIZE)
    const pages = (await Promise.all(
      starts.map((s) =>
        alegraFetch(config, path, { ...extraParams, start: String(s), limit: String(PAGE_SIZE) }),
      ),
    )) as Record<string, unknown>[][]

    for (const page of pages) {
      if (!Array.isArray(page) || page.length === 0) {
        done = true
        break
      }
      for (const row of page) out.push(map(row))
      if (page.length < PAGE_SIZE) {
        done = true
        break
      }
    }
    start += PAGE_CONCURRENCY * PAGE_SIZE
  }
  return out
}

// ── Mapeo crudo de Alegra → normalizado ──
function mapRawCategory(raw: Record<string, unknown>): AlegraCategory {
  return {
    alegraId: String(raw.id),
    name: String(raw.name ?? ""),
    parentAlegraId: raw.parent ? String((raw.parent as { id?: unknown }).id ?? raw.parent) : null,
    status: String(raw.status ?? "active"),
  }
}

/**
 * Marca del ítem, desde los customFields.
 *
 * Alegra no tiene campo de marca: cada cuenta la modela como un campo personalizado. Se busca por
 * nombre sin distinguir mayúsculas ni tildes, porque el nombre lo eligió quien configuró la cuenta.
 */
function marcaDeCustomFields(raw: Record<string, unknown>): string | null {
  const campos = Array.isArray(raw.customFields) ? (raw.customFields as Record<string, unknown>[]) : []
  for (const c of campos) {
    const nombre = String(c?.name ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
    if (nombre === "marca" || nombre === "brand") {
      const valor = String(c?.value ?? "").trim()
      if (valor) return valor
    }
  }
  return null
}

/**
 * Código (referencia) del ítem. Alegra lo manda como string o como `{ reference }` según el ítem.
 * Cualquier otra forma, o un vacío, da null (antes un `{ reference: null }` quedaba "[object Object]").
 */
function codigoDeItem(ref: unknown): string | null {
  const valor =
    typeof ref === "string"
      ? ref
      : ref !== null && typeof ref === "object" && (ref as { reference?: unknown }).reference != null
        ? String((ref as { reference: unknown }).reference)
        : null
  return valor ? valor : null
}

function mapRawItem(raw: Record<string, unknown>): AlegraProduct {
  const priceRaw = Array.isArray(raw.price) ? (raw.price as Record<string, unknown>[]) : []
  const prices: AlegraPrice[] = priceRaw.map((p) => ({
    idPriceList: String(p.idPriceList ?? p.id ?? ""),
    name: String(p.name ?? ""),
    price: Number(p.price ?? 0),
  }))
  const cat = raw.itemCategory as { id?: unknown } | undefined
  const inv = raw.inventory as { availableQuantity?: unknown } | undefined
  const imgs = Array.isArray(raw.images) ? (raw.images as Record<string, unknown>[]) : []
  return {
    alegraId: String(raw.id),
    code: codigoDeItem(raw.reference),
    name: String(raw.name ?? ""),
    description: raw.description ? String(raw.description) : null,
    categoryAlegraId: cat?.id != null ? String(cat.id) : null,
    prices,
    stock: inv?.availableQuantity != null ? Number(inv.availableQuantity) : null,
    status: String(raw.status ?? "active"),
    images: imgs.map((i) => String(i.url ?? "")).filter(Boolean),
    brand: marcaDeCustomFields(raw),
    // SUMA de los impuestos (regla única: alegra-impuestos.ts = public.alegra_suma_impuestos).
    ivaPorcentaje: sumaImpuestos(raw.tax),
    // Se guarda entero: cada vez que hizo falta un campo que el mapper no leía hubo que tocarlo
    // y re-sincronizar. Con el crudo, se resuelve con una query.
    raw,
  }
}

function mapRawContact(raw: Record<string, unknown>): AlegraContact {
  const ident = raw.identification
  const priceList = raw.priceList as { id?: unknown; name?: unknown } | undefined
  const seller = raw.seller as { id?: unknown; name?: unknown } | undefined
  const term = raw.term as { id?: unknown; name?: unknown; days?: unknown } | undefined
  return {
    alegraId: String(raw.id),
    name: String(raw.name ?? ""),
    // identification puede venir como string o como objeto { type, number } según el país
    identification:
      ident == null
        ? null
        : typeof ident === "object"
          ? String((ident as { number?: unknown }).number ?? "") || null
          : String(ident),
    email: raw.email ? String(raw.email) : null,
    phone: raw.phonePrimary ? String(raw.phonePrimary) : raw.mobile ? String(raw.mobile) : null,
    priceListId: priceList?.id != null ? String(priceList.id) : null,
    sellerId: seller?.id != null ? String(seller.id) : null,
    paymentTermId: term?.id != null ? String(term.id) : null,
    status: String(raw.status ?? "active"),
    paymentTermName: term?.name ? String(term.name) : null,
    // `days` llega como string ("15"); "De contado" puede traerlo vacío o en 0.
    paymentTermDays: term?.days != null && term.days !== "" && !Number.isNaN(Number(term.days)) ? Number(term.days) : null,
    priceListName: priceList?.name ? String(priceList.name) : null,
    sellerName: seller?.name ? String(seller.name) : null,
    creditLimit: raw.creditLimit != null && raw.creditLimit !== "" ? Number(raw.creditLimit) : null,
  }
}

// ── Fila del espejo de contactos (tabla alegra_contacts) ──
//
// La arma el cliente HTTP a partir del contacto crudo; la escribe lib/alegra-contacts-repo.ts.
// Faltan a propósito las columnas que pone la base o quien escribe: id, tenant_id,
// alegra_account, status, origen, synced_at y tipo_cuenta (generada).

export interface FilaContactoAlegra {
  alegraId: string
  name: string
  identification: string | null
  /** Solo dígitos; null si no queda ninguno. */
  identificationNorm: string | null
  email: string | null
  emailsNorm: string[]
  phonePrimary: string | null
  phoneSecondary: string | null
  mobile: string | null
  phonesNorm: string[]
  types: string[]
  priceListId: string | null
  priceListName: string | null
  priceListStatus: string | null
  sellerId: string | null
  sellerName: string | null
  paymentTermId: string | null
  paymentTermName: string | null
  paymentTermDays: number | null
  /** numeric(16,2): string, como lo maneja drizzle. null = no cargado. */
  creditLimit: string | null
  alegraStatus: string | null
  raw: Record<string, unknown>
}

/** Texto no vacío o null. Números se aceptan (Alegra a veces manda ids numéricos). */
function textoONull(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  if (typeof v !== "string") return null
  const t = v.trim()
  return t ? t : null
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Contacto crudo de Alegra → fila del espejo. Tolera las formas raras que devuelve la API:
 * identification como string u objeto `{ number }`, email como string, objeto o null,
 * `term.days` como string ("30", "") y `creditLimit` vacío.
 */
export function mapRawContactRow(raw: Record<string, unknown>): FilaContactoAlegra {
  const ident = raw.identification
  const identification =
    typeof ident === "string" || typeof ident === "number"
      ? textoONull(ident)
      : textoONull(objeto(ident)?.number)
  const identificationNorm = (identification ?? "").replace(/\D/g, "") || null

  // Un email que no es string (objeto, null) no se interpreta: queda en `raw`.
  const email = typeof raw.email === "string" ? textoONull(raw.email) : null
  const emailsNorm = [
    ...new Set(
      (email ?? "")
        .toLowerCase()
        .split(/[,; ]+/)
        .map((e) => e.trim())
        .filter(Boolean),
    ),
  ]

  const phonePrimary = textoONull(raw.phonePrimary)
  const phoneSecondary = textoONull(raw.phoneSecondary)
  const mobile = textoONull(raw.mobile)
  const phonesNorm = [...new Set([phonePrimary, phoneSecondary, mobile].map(normalizePhone).filter(Boolean))]

  const tipo = raw.type
  const types = (Array.isArray(tipo) ? tipo : [tipo]).filter((t): t is string => typeof t === "string" && t !== "")

  const priceList = objeto(raw.priceList)
  const seller = objeto(raw.seller)
  const term = objeto(raw.term)

  const dias = term?.days
  const diasNum = dias == null || dias === "" ? NaN : Number(dias)
  const limite = raw.creditLimit
  const limiteNum = limite == null || limite === "" ? NaN : Number(limite)

  return {
    alegraId: String(raw.id),
    name: String(raw.name ?? ""),
    identification,
    identificationNorm,
    email,
    emailsNorm,
    phonePrimary,
    phoneSecondary,
    mobile,
    phonesNorm,
    types,
    priceListId: textoONull(priceList?.id),
    priceListName: textoONull(priceList?.name),
    priceListStatus: textoONull(priceList?.status),
    sellerId: textoONull(seller?.id),
    sellerName: textoONull(seller?.name),
    paymentTermId: textoONull(term?.id),
    paymentTermName: textoONull(term?.name),
    paymentTermDays: Number.isFinite(diasNum) ? Math.trunc(diasNum) : null,
    creditLimit: Number.isFinite(limiteNum) ? String(limiteNum) : null,
    alegraStatus: textoONull(raw.status),
    raw,
  }
}

/**
 * Contacto del mock (ya normalizado) con la forma cruda de la API. Solo para modo
 * `alegraMock`: las funciones *Raw y la sync de contactos esperan el crudo.
 */
function mockContactARaw(c: AlegraContact): Record<string, unknown> {
  return {
    id: c.alegraId,
    name: c.name,
    identification: c.identification,
    email: c.email,
    phonePrimary: c.phone,
    type: ["client"],
    priceList: c.priceListId ? { id: c.priceListId, name: c.priceListName, status: "active" } : null,
    seller: c.sellerId ? { id: c.sellerId, name: c.sellerName } : null,
    term: c.paymentTermId
      ? { id: c.paymentTermId, name: c.paymentTermName, days: c.paymentTermDays != null ? String(c.paymentTermDays) : "" }
      : null,
    creditLimit: c.creditLimit,
    status: c.status,
  }
}

function mapRawPriceList(raw: Record<string, unknown>): AlegraPriceList {
  return {
    alegraId: String(raw.id),
    name: String(raw.name ?? ""),
    type: raw.type ? String(raw.type) : null,
    status: String(raw.status ?? "active"),
  }
}

function mapRawPaymentTerm(raw: Record<string, unknown>): AlegraPaymentTerm {
  return {
    alegraId: String(raw.id),
    name: String(raw.name ?? ""),
    days: raw.days != null ? Number(raw.days) : null,
  }
}

function mapRawSeller(raw: Record<string, unknown>): AlegraSeller {
  return {
    alegraId: String(raw.id),
    name: String(raw.name ?? ""),
    identification: raw.identification ? String(raw.identification) : null,
    status: String(raw.status ?? "active"),
  }
}

function mapRawTax(raw: Record<string, unknown>): AlegraTax {
  return {
    alegraId: String(raw.id),
    name: String(raw.name ?? ""),
    percentage: raw.percentage != null ? Number(raw.percentage) : null,
    status: String(raw.status ?? "active"),
  }
}

function mapRawCurrency(raw: Record<string, unknown>): AlegraCurrency {
  return {
    code: String(raw.code ?? ""),
    name: String(raw.name ?? ""),
    symbol: raw.symbol ? String(raw.symbol) : null,
    exchangeRate: raw.exchangeRate != null ? Number(raw.exchangeRate) : null,
  }
}

function mapRawEstimate(raw: Record<string, unknown>): AlegraEstimate {
  const client = (raw.client ?? {}) as Record<string, unknown>
  const itemsRaw = Array.isArray(raw.items) ? (raw.items as Record<string, unknown>[]) : []
  return {
    alegraId: String(raw.id),
    number: raw.number != null ? String(raw.number) : null,
    date: String(raw.date ?? ""),
    dueDate: raw.dueDate ? String(raw.dueDate) : null,
    clientAlegraId: client.id != null ? String(client.id) : "",
    clientName: String(client.name ?? ""),
    status: String(raw.status ?? ""),
    total: Number(raw.total ?? 0),
    observations: raw.observations ? String(raw.observations) : null,
    items: itemsRaw.map((it) => ({
      alegraId: String(it.id),
      name: String(it.name ?? ""),
      quantity: Number(it.quantity ?? 0),
      price: Number(it.price ?? 0),
      discount: Number(it.discount ?? 0),
    })),
  }
}

function mapRawInvoice(raw: Record<string, unknown>): AlegraInvoice {
  const client = (raw.client ?? {}) as Record<string, unknown>
  const numberTemplate = raw.numberTemplate as { fullNumber?: unknown; formattedNumber?: unknown } | undefined
  const fullNumber = numberTemplate?.fullNumber ?? numberTemplate?.formattedNumber ?? raw.number
  return {
    alegraId: String(raw.id),
    number: fullNumber != null ? String(fullNumber) : null,
    date: String(raw.date ?? ""),
    dueDate: raw.dueDate ? String(raw.dueDate) : null,
    total: Number(raw.total ?? 0),
    balance: Number(raw.balance ?? 0),
    status: String(raw.status ?? "open"),
    clientAlegraId: client.id != null ? String(client.id) : "",
  }
}

function mapRawPayment(raw: Record<string, unknown>): AlegraPayment {
  const method = raw.paymentMethod as { name?: unknown } | string | undefined
  const invoicesRaw = Array.isArray(raw.invoices) ? (raw.invoices as Record<string, unknown>[]) : []
  return {
    alegraId: String(raw.id),
    number: raw.number != null ? String(raw.number) : null,
    date: String(raw.date ?? ""),
    amount: Number(raw.amount ?? 0),
    method:
      typeof method === "string" ? method : method?.name != null ? String(method.name) : String(raw.paymentMethod ?? ""),
    invoices: invoicesRaw.map((inv) => {
      const numberTemplate = inv.numberTemplate as { fullNumber?: unknown } | undefined
      return {
        invoiceAlegraId: String(inv.id),
        invoiceNumber: numberTemplate?.fullNumber != null ? String(numberTemplate.fullNumber) : inv.number != null ? String(inv.number) : null,
        // Alegra devuelve el monto imputado en `amount` dentro de cada factura del pago
        amount: Number(inv.amount ?? 0),
      }
    }),
  }
}

function mapRawBankAccount(raw: Record<string, unknown>): AlegraBankAccount {
  return {
    alegraId: String(raw.id),
    name: String(raw.name ?? ""),
    type: raw.type != null ? String(raw.type) : null,
    status: String(raw.status ?? "active"),
  }
}

// ── API pública del cliente ──

/** Todas las categorías de ítems del tenant. Para la sync. */
export async function listAllCategories(config: TenantConfig): Promise<AlegraCategory[]> {
  if (config.alegraMock) return mockCategories
  return fetchAllPages(config, "/item-categories", mapRawCategory)
}

/** Todos los productos del tenant (modo advanced: trae categoría, inventario, precios). Para la sync. */
export async function listAllItems(config: TenantConfig): Promise<AlegraProduct[]> {
  if (config.alegraMock) return mockItems
  return fetchAllPages(config, "/items", mapRawItem, { order_field: "id", order_direction: "ASC" })
}

/** Precio/stock EN VIVO de ítems puntuales (momento decisivo: checkout, presupuesto del bot). */
export async function getItemsLive(config: TenantConfig, alegraIds: string[]): Promise<AlegraProduct[]> {
  const ids = [...new Set(alegraIds)].filter(Boolean)
  if (config.alegraMock) {
    return ids.map((id) => getMockItemLive(id)).filter((x): x is AlegraProduct => x !== null)
  }
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const raw = (await alegraFetch(config, `/items/${id}`)) as Record<string, unknown>
        return mapRawItem(raw)
      } catch {
        return null
      }
    }),
  )
  return results.filter((x): x is AlegraProduct => x !== null)
}

/**
 * UN ítem por id (1 request, más reintentos por 429), para el espejo: lo usa el drenador de
 * avisos de stock (lib/alegra-stock-cola.ts). A diferencia de `getItemsLive`, que se traga todo
 * error, distingue "no existe" (404 → null) de "Alegra nos frena" (AlegraRateLimitError) y de
 * "Alegra falló" (AlegraHttpError): un error no puede leerse como "lo borraron".
 * `onRequest` se llama por cada request HTTP, reintentos incluidos.
 */
export async function getItemParaEspejo(
  config: TenantConfig,
  alegraId: string,
  opts: { reintentos429?: number; onRequest?: () => void } = {},
): Promise<AlegraProduct | null> {
  if (config.alegraMock) return getMockItemLive(alegraId)
  try {
    const raw = (await alegraFetch(config, `/items/${encodeURIComponent(alegraId)}`, undefined, undefined, {
      reintentos429: opts.reintentos429,
      onRequest: opts.onRequest,
    })) as Record<string, unknown>
    return mapRawItem(raw)
  } catch (err) {
    if (err instanceof AlegraHttpError && err.status === 404) return null
    throw err
  }
}

// ── Contactos (clientes de Alegra) ──

/** Busca contactos por nombre/identificación. `query` usa la búsqueda global de Alegra. */
export async function searchContacts(config: TenantConfig, query: string, limit = 20): Promise<AlegraContact[]> {
  if (config.alegraMock) return buscarEnMock(query, limit)
  return (await searchContactsRaw(config, query, limit)).map(mapRawContact)
}

function buscarEnMock(query: string, limit: number): AlegraContact[] {
  // Sin tildes para que "san martin" encuentre "San Martín" (la API real resuelve esto server-side)
  const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  const q = fold(query)
  return mockContacts
    .filter(
      (c) =>
        fold(c.name).includes(q) ||
        (c.identification ?? "").includes(query) ||
        (c.email ?? "").toLowerCase() === query.toLowerCase(),
    )
    .slice(0, limit)
}

/** Como `searchContacts`, pero devuelve el crudo de Alegra (para el espejo). 1 request. */
export async function searchContactsRaw(
  config: TenantConfig,
  query: string,
  limit = 20,
): Promise<Record<string, unknown>[]> {
  if (config.alegraMock) return buscarEnMock(query, limit).map(mockContactARaw)
  const page = (await alegraFetch(config, "/contacts", {
    query,
    limit: String(Math.min(limit, PAGE_SIZE)),
  })) as Record<string, unknown>[]
  return Array.isArray(page) ? page : []
}

/**
 * Contacto crudo por id (1 request), para el espejo: fallback de `contactoPorId` y avisos de
 * los webhooks. Distingue "no existe" (404 → null) de "Alegra falló" (tira): un error no
 * puede leerse como "no está". `reintentos429` acota los reintentos (default: los de siempre).
 */
export async function getContactRaw(
  config: TenantConfig,
  alegraId: string,
  opts: { reintentos429?: number } = {},
): Promise<Record<string, unknown> | null> {
  if (config.alegraMock) {
    const c = mockContacts.find((m) => m.alegraId === alegraId)
    return c ? mockContactARaw(c) : null
  }
  try {
    return (await alegraFetch(config, `/contacts/${encodeURIComponent(alegraId)}`, undefined, undefined, {
      reintentos429: opts.reintentos429,
    })) as Record<string, unknown>
  } catch (err) {
    if (err instanceof AlegraHttpError && err.status === 404) return null
    throw err
  }
}

function crearEnMock(input: AlegraContactInput): AlegraContact {
  const created: AlegraContact = {
    alegraId: String(Date.now()),
    name: input.name,
    identification: input.identification ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    priceListId: null,
    sellerId: null,
    paymentTermId: null,
    status: "active",
    paymentTermName: null,
    paymentTermDays: null,
    priceListName: null,
    sellerName: null,
    creditLimit: null,
  }
  mockContacts.push(created)
  return created
}

/**
 * Crea un contacto en Alegra (cliente nuevo) y devuelve el crudo que respondió, para
 * escribirlo en el espejo (write-through, ver `crearContacto` en lib/contactos.ts). Lo usa el
 * agente cuando el cliente da su CUIT y no existe todavía. `name` es lo único obligatorio.
 */
export async function createContactRaw(config: TenantConfig, input: AlegraContactInput): Promise<Record<string, unknown>> {
  if (config.alegraMock) return mockContactARaw(crearEnMock(input))
  const body: Record<string, unknown> = { name: input.name }
  if (input.identification) body.identification = input.identification
  if (input.email) body.email = input.email
  if (input.phone) body.phone = input.phone
  return (await alegraFetch(config, "/contacts", undefined, { method: "POST", body })) as Record<string, unknown>
}

// ── Identificación por teléfono ──
//
// El bot de WhatsApp necesita saber quién le escribe sin preguntarle el nombre: el número
// llega verificado por Meta, mientras que un nombre lo escribe cualquiera. Y buscar por
// nombre en esta cuenta es ambiguo de entrada — hay tres "Sergio", dos "Arrow", dos
// "Roberto" y varios "Carlos".
//
// La búsqueda de Alegra (?query=) mira nombre e identificación, NO los teléfonos. Antes eso
// se resolvía bajando el padrón entero en cada mensaje; ahora el teléfono se busca en el
// espejo (`buscarPorTelefono` en lib/contactos.ts, columna phones_norm) y acá quedan solo la
// normalización y el filtro de cuentas internas, que usan el espejo y la sync.

/**
 * Últimos 10 dígitos del teléfono, que en Argentina son área + abonado. El mismo número
 * llega en formatos distintos según de dónde salga: "5492235550112" (wa_id, sin '+'),
 * "+5492235550112" (Alegra), "02235550112" y "223 555 0112" (carga a mano). Comparar la
 * cola evita tener que adivinar si trae código de país o el 15.
 *
 * Menos de 8 dígitos devuelve "": no alcanza para identificar una línea y matchearía de
 * más, así que se trata como si no hubiera teléfono.
 */
export function normalizePhone(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "")
  if (digits.length < 8) return ""
  return digits.slice(-10)
}

// Contactos que existen en Alegra pero no son un cliente al que se le pueda atribuir un
// pedido: cuentas internas y marcadores. Si alguno tiene un teléfono cargado por arrastre,
// un match automático le colgaría el pedido a "Stock general". Se filtran SOLO en la
// búsqueda por teléfono, que es la automática y desatendida; la búsqueda por nombre la
// dispara una persona y no conviene ocultarle resultados.
const CUENTAS_NO_CLIENTE = new Set(["no usar", "stock taller", "stock general", "pos", "general", "empresa", "hotel"])

export function esCliente(name: string): boolean {
  const n = name.trim().toLowerCase()
  if (!n) return false
  if (n.includes("no usar")) return false
  return !CUENTAS_NO_CLIENTE.has(n)
}

/**
 * UNA página del padrón de contactos, CRUDA, para la sync por tramos del espejo
 * (lib/alegra-contacts-sync.ts). Es el ÚNICO lugar que recorre el padrón completo, y lo hace
 * de a una página por llamada: el ritmo lo pone quien llama.
 *
 * `/contacts` admite ~5 requests por minuto por cuenta (probado 2026-09-23; `/items` no tiene
 * ese tope) y el login del portal y el bot comparten ese cupo. Por eso la sync pide pocas
 * páginas por invocación y NO reintenta el 429 por defecto (`reintentos429: 0`): lo recibe
 * como `AlegraRateLimitError` y corta el tramo.
 *
 * Devuelve la página tal cual (hasta `PAGE_SIZE` filas; menos = última página).
 * `onRequest`: se llama por cada request HTTP, reintentos incluidos.
 */
export async function paginaDeContactos(
  config: TenantConfig,
  start: number,
  opts: { onRequest?: () => void; reintentos429?: number } = {},
): Promise<Record<string, unknown>[]> {
  if (config.alegraMock) return mockContacts.map(mockContactARaw).slice(start, start + PAGE_SIZE)
  const page = (await alegraFetch(
    config,
    "/contacts",
    { start: String(start), limit: String(PAGE_SIZE) },
    undefined,
    { onRequest: opts.onRequest, reintentos429: opts.reintentos429 ?? 0 },
  )) as unknown
  return Array.isArray(page) ? (page as Record<string, unknown>[]) : []
}

/** Tamaño de página de Alegra (topea `limit` en 30). La sync lo usa para detectar la última. */
export const ALEGRA_PAGE_SIZE = PAGE_SIZE

// ── Webhooks (suscripciones de la cuenta) ──
//
// Alegra avisa por POST a una URL cuando pasa un evento de la cuenta. La suscripción es
// `POST /webhooks/subscriptions { event, url }`. Se usan dos juegos:
// - contactos (`new-client`, `edit-client`, `delete-client`): mantienen al día el espejo de
//   contactos (lib/alegra-contacts-webhook.ts, scripts/alegra-webhooks-contactos.ts);
// - stock (`EVENTOS_STOCK`: facturas, compras e ítems): disparan la re-lectura de los ítems
//   tocados (lib/alegra-stock-webhook.ts, scripts/alegra-webhooks-stock.ts).
// Crear o borrar una suscripción cambia la configuración de la cuenta REAL del cliente: lo hace
// una persona con esos scripts.

/**
 * Eventos de stock. El aviso NO trae el stock que vale (una factura no dispara edit-item):
 * sólo dice qué ítems re-leer. `edit-bill` se aceptó al suscribir (201) el 2026-09-24.
 */
export const EVENTOS_STOCK = [
  "new-invoice",
  "edit-invoice",
  "delete-invoice",
  "new-bill",
  "edit-bill",
  "delete-bill",
  "new-item",
  "edit-item",
  "delete-item",
] as const

export interface AlegraWebhookSubscription {
  id: string
  event: string
  url: string
}

function mapRawSubscription(raw: Record<string, unknown>): AlegraWebhookSubscription {
  return { id: String(raw.id ?? ""), event: String(raw.event ?? ""), url: String(raw.url ?? "") }
}

export async function listWebhookSubscriptions(config: TenantConfig): Promise<AlegraWebhookSubscription[]> {
  const res = (await alegraFetch(config, "/webhooks/subscriptions")) as unknown
  // Según la cuenta viene como lista o envuelto en { data: [...] }.
  const filas = Array.isArray(res) ? res : Array.isArray((res as { data?: unknown })?.data) ? (res as { data: unknown[] }).data : []
  return (filas as Record<string, unknown>[]).map(mapRawSubscription)
}

/**
 * Alegra rechaza la URL de una suscripción si trae el esquema: responde 400 "La URL ingresada
 * no debe incluir el http:// o https://" (probado 2026-09-23). Se registra `host/ruta`.
 */
export function urlSinEsquema(url: string): string {
  return url.replace(/^https?:\/\//i, "")
}

export async function createWebhookSubscription(
  config: TenantConfig,
  event: string,
  url: string,
): Promise<AlegraWebhookSubscription> {
  const raw = (await alegraFetch(config, "/webhooks/subscriptions", undefined, {
    method: "POST",
    body: { event, url: urlSinEsquema(url) },
  })) as Record<string, unknown> | null
  const sub = (raw as { subscription?: unknown } | null)?.subscription ?? raw
  return mapRawSubscription((sub ?? {}) as Record<string, unknown>)
}

export async function deleteWebhookSubscription(config: TenantConfig, id: string): Promise<void> {
  await alegraFetch(config, `/webhooks/subscriptions/${encodeURIComponent(id)}`, undefined, { method: "DELETE" })
}

// ── Configuración de venta: listas de precio, formas de pago, vendedores, impuestos, monedas ──

export async function listPriceLists(config: TenantConfig): Promise<AlegraPriceList[]> {
  if (config.alegraMock) return mockPriceLists
  return fetchAllPages(config, "/price-lists", mapRawPriceList)
}

/** Términos/condiciones de pago (contado, 30 días, etc.). Endpoint /terms de Alegra. */
export async function listPaymentTerms(config: TenantConfig): Promise<AlegraPaymentTerm[]> {
  if (config.alegraMock) return mockPaymentTerms
  const page = (await alegraFetch(config, "/terms")) as Record<string, unknown>[]
  return Array.isArray(page) ? page.map(mapRawPaymentTerm) : []
}

export async function listSellers(config: TenantConfig): Promise<AlegraSeller[]> {
  if (config.alegraMock) return mockSellers
  const page = (await alegraFetch(config, "/sellers")) as Record<string, unknown>[]
  return Array.isArray(page) ? page.map(mapRawSeller) : []
}

export async function listTaxes(config: TenantConfig): Promise<AlegraTax[]> {
  if (config.alegraMock) return mockTaxes
  const page = (await alegraFetch(config, "/taxes")) as Record<string, unknown>[]
  return Array.isArray(page) ? page.map(mapRawTax) : []
}

export async function listCurrencies(config: TenantConfig): Promise<AlegraCurrency[]> {
  if (config.alegraMock) return mockCurrencies
  const page = (await alegraFetch(config, "/currencies")) as Record<string, unknown>[]
  return Array.isArray(page) ? page.map(mapRawCurrency) : []
}

// ── Cotizaciones (estimates) — la única ESCRITURA permitida contra Alegra ──

/** Crea una cotización. No es documento fiscal: se puede borrar por API (deleteEstimate). */
export async function createEstimate(config: TenantConfig, input: AlegraEstimateInput): Promise<AlegraEstimate> {
  if (config.alegraMock) return mockCreateEstimate(input)
  const body: Record<string, unknown> = {
    client: Number.isNaN(Number(input.contactAlegraId)) ? input.contactAlegraId : Number(input.contactAlegraId),
    date: new Date().toISOString().slice(0, 10),
    items: input.items.map((it) => ({
      id: Number.isNaN(Number(it.alegraId)) ? it.alegraId : Number(it.alegraId),
      quantity: it.quantity,
      ...(it.price !== undefined ? { price: it.price } : {}),
      ...(it.discount !== undefined ? { discount: it.discount } : {}),
    })),
  }
  if (input.dueDate) body.dueDate = input.dueDate
  if (input.observations) body.observations = input.observations
  if (input.anotation) body.anotation = input.anotation
  if (input.priceListId) body.priceList = Number(input.priceListId)
  if (input.sellerId) body.seller = Number(input.sellerId)
  const raw = (await alegraFetch(config, "/estimates", undefined, { method: "POST", body })) as Record<
    string,
    unknown
  >
  return mapRawEstimate(raw)
}

export async function getEstimate(config: TenantConfig, alegraId: string): Promise<AlegraEstimate | null> {
  if (config.alegraMock) return mockListEstimates().find((e) => e.alegraId === alegraId) ?? null
  try {
    const raw = (await alegraFetch(config, `/estimates/${alegraId}`)) as Record<string, unknown>
    return mapRawEstimate(raw)
  } catch {
    return null
  }
}

/** Cotizaciones de un contacto (para "¿qué le coticé?"). */
export async function listEstimatesByContact(config: TenantConfig, contactAlegraId: string): Promise<AlegraEstimate[]> {
  if (config.alegraMock) return mockListEstimates().filter((e) => e.clientAlegraId === contactAlegraId)
  const page = (await alegraFetch(config, "/estimates", {
    client_id: contactAlegraId,
    limit: String(PAGE_SIZE),
    order_field: "id",
    order_direction: "DESC",
  })) as Record<string, unknown>[]
  return Array.isArray(page) ? page.map(mapRawEstimate) : []
}

/** Borra una cotización. Lo usa el smoke test para no dejar datos en cuentas reales. */
export async function deleteEstimate(config: TenantConfig, alegraId: string): Promise<void> {
  if (config.alegraMock) {
    mockDeleteEstimate(alegraId)
    return
  }
  await alegraFetch(config, `/estimates/${alegraId}`, undefined, { method: "DELETE" })
}

// ── Facturas y pagos (cuenta corriente del cliente) ──
// Alegra es el ERP: el portal lee de acá lo que antes venía de Flexxus. Ver lib/erp.ts.

/** Facturas de venta de un contacto (todas; el portal filtra por estado). */
export async function listInvoicesByContact(config: TenantConfig, contactAlegraId: string): Promise<AlegraInvoice[]> {
  if (config.alegraMock) return mockInvoicesByContact(contactAlegraId)
  return fetchAllPages(config, "/invoices", mapRawInvoice, {
    client_id: contactAlegraId,
    order_field: "date",
    order_direction: "DESC",
  })
}

/** Pagos (recibos) recibidos de un contacto, con sus imputaciones a facturas. */
export async function listPaymentsByContact(config: TenantConfig, contactAlegraId: string): Promise<AlegraPayment[]> {
  if (config.alegraMock) return mockPaymentsByContact(contactAlegraId)
  return fetchAllPages(config, "/payments", mapRawPayment, {
    client_id: contactAlegraId,
    type: "in", // solo cobros al cliente, no pagos a proveedores
    order_field: "date",
    order_direction: "DESC",
  })
}

/**
 * Todas las facturas ABIERTAS (impagas) del contacto.
 *
 * Es un set chico (para un cliente con 1282 facturas son 10) y se trae entero: de acá salen el
 * saldo, los contadores de vencidas/pendientes y los chips Pendientes/Vencidas. Alegra filtra
 * por `status=open` pero no por vencimiento, así que el corte vencida/pendiente se hace sobre
 * este set completo, no sobre una página.
 *
 * Límite conocido: no está paginado. Un cliente con cientos de facturas impagas haría varios
 * pedidos. No hay alternativa: Alegra no tiene endpoint de saldo (probados /statement,
 * /balance, /account-statement → 404, fields=balance → null).
 */
export async function listOpenInvoicesByContact(config: TenantConfig, contactAlegraId: string): Promise<AlegraInvoice[]> {
  if (config.alegraMock) {
    return (await listInvoicesByContact(config, contactAlegraId)).filter((i) => i.status === "open")
  }
  return fetchAllPages(config, "/invoices", mapRawInvoice, { client_id: contactAlegraId, status: "open" })
}

/** Saldo de cuenta corriente a partir de las facturas abiertas: vencido vs. a vencer. */
export function computeBalance(invoices: AlegraInvoice[]): AlegraContactBalance {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let total = 0
  let overdue = 0
  for (const inv of invoices) {
    if (inv.status === "closed" || inv.status === "void" || inv.balance <= 0) continue
    total += inv.balance
    const due = inv.dueDate ? new Date(`${inv.dueDate}T00:00:00`) : null
    if (due && due < today) overdue += inv.balance
  }
  return { total, overdue, toFallDue: total - overdue }
}

export async function getContactBalance(config: TenantConfig, contactAlegraId: string): Promise<AlegraContactBalance> {
  return computeBalance(await listOpenInvoicesByContact(config, contactAlegraId))
}

/** Cuentas bancarias del tenant (para el select de cuenta destino al cargar un pago).
 *  Por defecto Alegra devuelve solo las activas; las inactivas solo entran pidiéndolas. */
export async function listBankAccounts(config: TenantConfig): Promise<AlegraBankAccount[]> {
  if (config.alegraMock) return []
  return fetchAllPages(config, "/bank-accounts", mapRawBankAccount)
}

/**
 * Crea el pago (recibo de caja) en Alegra, imputado a las facturas dadas. `notes` va como
 * `observations`: no se imprime en el documento que ve el cliente (la alternativa `anotation`
 * sí se imprime). El número del pago viene en la respuesta del POST; si la cuenta no lo trae,
 * se consulta el pago una vez (GET /payments/{id}, mismo shape) antes de rendirse con null.
 */
export async function createPayment(config: TenantConfig, input: AlegraPaymentCreateInput): Promise<AlegraPaymentCreated> {
  if (config.alegraMock) {
    // Id numérico puro: la fila guarda alegra_payment_id como integer.
    return { alegraId: String(Date.now()), number: null }
  }
  const body: Record<string, unknown> = {
    client: Number(input.contactAlegraId),
    date: input.date,
    paymentMethod: input.paymentMethod,
    invoices: input.invoices.map((inv) => ({ id: Number(inv.alegraId), amount: inv.amount })),
  }
  if (input.bankAccountId) body.bankAccount = { id: Number(input.bankAccountId) }
  if (input.notes) body.observations = input.notes.slice(0, 500)
  const raw = (await alegraFetch(config, "/payments", undefined, { method: "POST", body })) as Record<string, unknown>

  let created = mapRawPayment(raw)
  if (created.number === null) {
    try {
      const fetched = (await alegraFetch(config, `/payments/${created.alegraId}`)) as Record<string, unknown>
      created = mapRawPayment(fetched)
    } catch {
      // El pago existe pero no conseguimos su número: no vale fallar la carga por eso.
    }
  }
  return { alegraId: created.alegraId, number: created.number }
}

/**
 * Adjunta un archivo al pago de Alegra (POST multipart, campo `file`, tope 2 MB). El caller
 * decide si vale la pena: acá el adjunto es best-effort — quien lo llama lo envuelve en
 * try/catch y sigue aunque esto falle. Devuelve la URL firmada (vence a los 30 min) o null
 * si Alegra no devolvió una.
 */
export async function attachFileToPayment(
  config: TenantConfig,
  paymentAlegraId: string,
  file: { name: string; contentType: string; bytes: Uint8Array },
): Promise<string | null> {
  if (config.alegraMock) return null
  const form = new FormData()
  // Uint8Array genérico (ArrayBufferLike) no calza con BlobPart de TS 5.7+; el runtime acepta cualquier Uint8Array.
  form.append("file", new Blob([file.bytes as unknown as BlobPart], { type: file.contentType }), file.name)

  const url = `${ALEGRA_BASE}/payments/${paymentAlegraId}/attachment`
  const res = await fetch(url, { method: "POST", headers: { Authorization: authHeader(config) }, body: form, cache: "no-store" })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`Alegra error ${res.status} en /payments/${paymentAlegraId}/attachment${detail ? `: ${detail.slice(0, 300)}` : ""}`)
  }
  const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return raw && typeof raw.url === "string" ? raw.url : null
}

// ── Factura para vincular a un pedido del Shop ("Vincular factura" del admin) ──────────
// El operador hizo la factura en Alegra por fuera y la vincula al pedido para liberar la
// reserva de stock. Se lee UNA factura (por id o por número) con pocos reintentos por 429: es
// una acción interactiva, no puede quedarse esperando 30 s al cupo, y comparte la cuota con la
// sync, el portal y el bot.

export interface AlegraFacturaResumen {
  alegraId: string
  /** Número legible tal como lo muestra Alegra (ej. "00201-00007040"), o null. */
  numero: string | null
  /** Emisión, YYYY-MM-DD. */
  fecha: string
  total: number
  /** open | closed | draft | void */
  estado: string
  clienteAlegraId: string | null
  clienteNombre: string | null
}

const REINTENTOS_429_INTERACTIVO = 1

function mapRawFacturaResumen(raw: Record<string, unknown>): AlegraFacturaResumen {
  const client = (raw.client ?? {}) as Record<string, unknown>
  const numberTemplate = raw.numberTemplate as { fullNumber?: unknown; formattedNumber?: unknown } | undefined
  const fullNumber = numberTemplate?.fullNumber ?? numberTemplate?.formattedNumber ?? raw.number
  return {
    alegraId: String(raw.id),
    numero: fullNumber != null && String(fullNumber).trim() ? String(fullNumber) : null,
    fecha: String(raw.date ?? ""),
    total: Number(raw.total ?? 0),
    estado: String(raw.status ?? ""),
    clienteAlegraId: client.id != null ? String(client.id) : null,
    clienteNombre: client.name != null && String(client.name).trim() ? String(client.name) : null,
  }
}

function resumenDeMock(inv: AlegraInvoice): AlegraFacturaResumen {
  return {
    alegraId: inv.alegraId,
    numero: inv.number,
    fecha: inv.date,
    total: inv.total,
    estado: inv.status,
    clienteAlegraId: inv.clientAlegraId || null,
    clienteNombre: null,
  }
}

/**
 * Una factura por id. 404 → null; 429 → AlegraRateLimitError; otro error → AlegraHttpError.
 * Un id que no son sólo dígitos no se consulta (nunca se arma un path con lo que tipeó el
 * operador).
 */
export async function getFacturaPorId(
  config: TenantConfig,
  alegraId: string,
  opts: { reintentos429?: number } = {},
): Promise<AlegraFacturaResumen | null> {
  if (config.alegraMock) {
    const inv = mockAllInvoices().find((i) => i.alegraId === alegraId)
    return inv ? resumenDeMock(inv) : null
  }
  if (!/^\d+$/.test(alegraId)) return null
  try {
    const raw = (await alegraFetch(config, `/invoices/${alegraId}`, undefined, undefined, {
      reintentos429: opts.reintentos429 ?? REINTENTOS_429_INTERACTIVO,
    })) as Record<string, unknown> | null
    if (!raw || raw.id == null) return null
    return mapRawFacturaResumen(raw)
  } catch (err) {
    if (err instanceof AlegraHttpError && err.status === 404) return null
    throw err
  }
}

/**
 * Facturas candidatas para un número tipeado: UNA página (30) de `/invoices` con el filtro
 * `numberTemplate_fullNumber`, de la más reciente a la más vieja, opcionalmente del cliente.
 *
 * Probado contra Alegra el 2026-09-24: el filtro funciona con el número completo
 * ("00201-00007040" → esa sola) y con la parte final ("7040" → las de todas las numeraciones
 * que terminan así); no completa ceros ("201-7040" → ninguna: lo normaliza
 * `numeroParaConsulta`). Igual NO se confía en él: el listado ignora en silencio los filtros
 * que no conoce (`number`, `query`, ver "Facturas paginadas") y ahí devuelve las 30 más
 * recientes. Quien llama se queda sólo con las que coinciden con lo tipeado
 * (`numeroFacturaCoincide`, lib/factura-vincular.ts).
 */
export async function buscarFacturasPorNumero(
  config: TenantConfig,
  numero: string,
  opts: { clientId?: string; reintentos429?: number } = {},
): Promise<AlegraFacturaResumen[]> {
  if (config.alegraMock) {
    return mockAllInvoices()
      .filter((i) => !opts.clientId || i.clientAlegraId === opts.clientId)
      .map(resumenDeMock)
  }
  const page = await alegraFetch(
    config,
    "/invoices",
    {
      numberTemplate_fullNumber: numero,
      ...(opts.clientId ? { client_id: opts.clientId } : {}),
      order_field: "date",
      order_direction: "DESC",
      start: "0",
      limit: String(PAGE_SIZE),
    },
    undefined,
    { reintentos429: opts.reintentos429 ?? REINTENTOS_429_INTERACTIVO },
  )
  return Array.isArray(page) ? (page as Record<string, unknown>[]).map(mapRawFacturaResumen) : []
}

// ── PDF de documentos (facturas, recibos de pago, cotizaciones) ──────────────
// Alegra no expone el PDF como recurso propio: hay que pedir el documento con
// `?fields=pdf` y devuelve una URL FIRMADA de su CDN, con `Expires` y `Signature`.
// Dos consecuencias:
//   1. La URL vence → no sirve guardarla en la DB ni mandársela al cliente para después.
//   2. Quien tenga la URL entra sin autenticarse → nunca se la devolvemos al navegador
//      a secas: el portal valida primero que el documento sea del cliente logueado
//      (por eso esto también devuelve el id del cliente dueño).

/** Tipos de documento del portal y su recurso en Alegra. */
export const DOCUMENT_RESOURCES = {
  factura: "invoices",
  pago: "payments",
  presupuesto: "estimates",
} as const

export type DocumentKind = keyof typeof DOCUMENT_RESOURCES

export interface AlegraDocumentPdf {
  /** Id del contacto dueño del documento. `null` si Alegra no lo trae (→ tratar como ajeno). */
  clientAlegraId: string | null
  /** URL firmada del PDF, o `null` si Alegra no generó ninguno para este documento. */
  pdfUrl: string | null
  /** Número legible del documento, para nombrar el archivo que baja el cliente. */
  number: string | null
}

/**
 * Documento con su PDF firmado y el contacto dueño, para que el llamador valide
 * la pertenencia ANTES de servirlo. No filtra por cliente: eso es responsabilidad
 * de quien lo llama, que es el único que sabe quién está logueado.
 */
export async function getDocumentPdf(
  config: TenantConfig,
  kind: DocumentKind,
  documentId: string,
): Promise<AlegraDocumentPdf | null> {
  const raw = (await alegraFetch(config, `/${DOCUMENT_RESOURCES[kind]}/${documentId}`, {
    fields: "pdf",
  })) as Record<string, unknown> | null
  if (!raw || raw.id == null) return null

  const client = (raw.client ?? {}) as Record<string, unknown>
  const numberTemplate = raw.numberTemplate as { fullNumber?: unknown; formattedNumber?: unknown } | undefined
  const fullNumber = numberTemplate?.fullNumber ?? numberTemplate?.formattedNumber ?? raw.number

  return {
    clientAlegraId: client.id != null ? String(client.id) : null,
    pdfUrl: typeof raw.pdf === "string" && raw.pdf ? raw.pdf : null,
    number: fullNumber != null ? String(fullNumber) : null,
  }
}

// ── Búsqueda de contacto por documento del portal (CUIT, CUIL o DNI) ─────────
// El `query` de /contacts de Alegra matchea por nombre (un email exacto de un contacto
// existente devolvía []). Los filtros `email=` e `identification=` sí filtran: con un
// valor inexistente devuelven [] en vez de la primera página (probado contra la cuenta
// real, 2026-09-23), y son los que usa el Shop para vincular clientes.
//
// NUNCA se baja el padrón completo acá: el login es anónimo, y un CUIT inventado
// disparaba ~200 requests en ráfaga contra una cuota que comparten el CRM, el bot y el
// checkout del Shop (el 429 que tiró el login). El peor caso ahora son 4 requests.

/** Deja solo los dígitos: "20-12345678-9", "20123456789" y "20.123.456.789" son el mismo CUIT. */
function normalizeIdentification(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "")
}

/**
 * Formas en que puede estar cargado un documento en Alegra, sin repetir: tal cual se
 * tipeó, solo dígitos y, si es un CUIT (11 dígitos), con guiones XX-XXXXXXXX-X.
 * `identification=` compara el texto, así que no se sabe cuál de las tres guarda cada
 * contacto.
 */
export function variantesDocumento(tipeado: string): string[] {
  const digitos = normalizeIdentification(tipeado)
  const variantes = [tipeado.trim(), digitos]
  if (digitos.length === 11) {
    variantes.push(`${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`)
  }
  return [...new Set(variantes.filter(Boolean))]
}

async function contactosFiltradosRaw(
  config: TenantConfig,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const page = (await alegraFetch(config, "/contacts", {
    ...params,
    limit: String(PAGE_SIZE),
  })) as Record<string, unknown>[]
  return Array.isArray(page) ? page : []
}

/**
 * Contacto por CUIT, CUIL o DNI exacto, para el login del portal. `documento` llega ya
 * normalizado a dígitos (ver `normalizarDocumento`).
 *
 * Usa el filtro `identification=` con las formas en que puede estar cargado y `query=`
 * al final, y le exige al resultado el match exacto: que un contacto venga en la lista
 * no alcanza (un parcial dejaría entrar a la cuenta equivocada).
 */
export async function findContactByIdentifier(
  config: TenantConfig,
  documento: string,
): Promise<AlegraContact | null> {
  if (config.alegraMock) {
    if (!normalizeIdentification(documento)) return null
    const [match] = await searchContacts(config, documento, 1)
    return match ?? null
  }
  const raw = await findContactRawByIdentifier(config, documento)
  return raw ? mapRawContact(raw) : null
}

/**
 * Como `findContactByIdentifier`, pero devuelve el crudo (fallback en vivo del espejo).
 * Mismas consultas: peor caso 4 requests, y un 429 corta.
 */
export async function findContactRawByIdentifier(
  config: TenantConfig,
  documento: string,
): Promise<Record<string, unknown> | null> {
  const digitos = normalizeIdentification(documento)
  if (!digitos) return null

  if (config.alegraMock) {
    const [match] = buscarEnMock(documento, 1)
    return match ? mockContactARaw(match) : null
  }

  const esExacto = (raw: Record<string, unknown>) =>
    normalizeIdentification(mapRawContact(raw).identification) === digitos
  const intentos: Record<string, string>[] = [
    ...variantesDocumento(documento).map((v) => ({ identification: v })),
    { query: digitos },
  ]

  for (const params of intentos) {
    let candidatos: Record<string, unknown>[]
    try {
      candidatos = await contactosFiltradosRaw(config, params)
    } catch (err) {
      // Un 429 corta acá: seguir probando solo gasta más cuota. Cualquier otro error
      // de un filtro no decide nada; se prueba el siguiente.
      if (err instanceof AlegraRateLimitError) throw err
      continue
    }
    const match = candidatos.find(esExacto)
    if (match) return match
  }
  return null
}

// ── Facturas paginadas ──────────────────────────────────────────────────────
// El portal no puede bajar el historial completo: un cliente con 1282 facturas son 43
// páginas y ~7 s de espera.
//
// Qué acepta Alegra, probado contra la cuenta real (los nombres importan):
//   date_afterOrNow / date_beforeOrNow  ✅ rango por fecha de EMISIÓN
//   status=open|closed|void             ✅ y se combina con las fechas
//   date_after                          ❌ no existe, se ignora en silencio
//   dueDate_afterOrNow / _beforeOrNow   ❌ se ignoran: el vencimiento no se filtra
//   number / query                      ❌ se ignoran: no se puede buscar por número
//
// `limit` tiene tope 30 y pedir más no falla: DEVUELVE BASURA (con limit=100 vuelven 2
// filas). Por eso una ventana más grande se arma con varias requests de 30 en paralelo.

export interface AlegraInvoicePage {
  items: AlegraInvoice[]
  /** Total de facturas del contacto según Alegra, para saber cuántas faltan. */
  total: number
}

/**
 * Una ventana de facturas del contacto, de la más reciente a la más vieja.
 *
 * El `total` sale de `metadata=true` e incluye los borradores, que el portal esconde: si
 * el contacto tuviera borradores, el "mostrando X de Y" quedaría corto por esa cantidad.
 */
export interface AlegraInvoiceFilters {
  /** `open` | `closed` | `void`. Alegra no acepta varios a la vez. */
  status?: string
  /** Fecha de EMISIÓN desde / hasta, "YYYY-MM-DD". Ojo: el vencimiento no se puede filtrar
   *  — `dueDate_afterOrNow` y `dueDate_beforeOrNow` los ignora (probado). */
  dateFrom?: string
  dateTo?: string
}

/**
 * Una ventana [start, start+limit) de un listado de Alegra, con el total.
 *
 * `pageSize` es el tamaño de cada request. Alegra topea en 30, pero pedir más no falla:
 * devuelve basura (con limit=100 vuelven 2 filas). Una ventana más grande se arma con varias
 * requests en paralelo. Para pagos conviene bajarlo: cada pago trae embebidas sus facturas
 * imputadas y 30 tardan ~9 s.
 */
async function fetchWindow<T>(
  config: TenantConfig,
  path: string,
  map: (raw: Record<string, unknown>) => T,
  params: Record<string, string>,
  { start, limit, pageSize = PAGE_SIZE }: { start: number; limit: number; pageSize?: number },
): Promise<{ items: T[]; total: number }> {
  const size = Math.min(pageSize, PAGE_SIZE)
  const chunks = Math.max(1, Math.ceil(limit / size))
  const responses = await Promise.all(
    Array.from({ length: chunks }, (_, i) =>
      alegraFetch(config, path, {
        ...params,
        start: String(start + i * size),
        limit: String(Math.min(size, limit - i * size)),
        // Solo la primera pide el total: viene igual en todas.
        ...(i === 0 ? { metadata: "true" } : {}),
      }),
    ),
  )
  let total = 0
  const items: T[] = []
  responses.forEach((res, i) => {
    // Con metadata=true la respuesta es { metadata, data }; sin él, el array pelado.
    const rows = Array.isArray(res)
      ? res
      : ((res as { data?: unknown }).data as Record<string, unknown>[] | undefined) ?? []
    if (i === 0 && !Array.isArray(res)) {
      total = Number((res as { metadata?: { total?: unknown } }).metadata?.total ?? 0)
    }
    for (const row of rows) items.push(map(row))
  })
  return { items, total }
}

export async function listInvoicesPageByContact(
  config: TenantConfig,
  contactAlegraId: string,
  { start, limit, filters = {} }: { start: number; limit: number; filters?: AlegraInvoiceFilters },
): Promise<AlegraInvoicePage> {
  if (config.alegraMock) {
    const all = await listInvoicesByContact(config, contactAlegraId)
    return { items: all.slice(start, start + limit), total: all.length }
  }
  return fetchWindow(config, "/invoices", mapRawInvoice, {
    client_id: contactAlegraId,
    order_field: "date",
    order_direction: "DESC",
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.dateFrom ? { date_afterOrNow: filters.dateFrom } : {}),
    ...(filters.dateTo ? { date_beforeOrNow: filters.dateTo } : {}),
  }, { start, limit })
}

/**
 * Pagos (recibos) del contacto, del más reciente al más viejo.
 *
 * Probado contra la cuenta real: hay total con metadata, pero `date_afterOrNow` y
 * `date_beforeOrNow` se IGNORAN en pagos (a diferencia de facturas), así que no se ofrece
 * filtro de fecha. Y son pesados: 30 pagos tardan ~9 s, 10 tardan ~3,7 s.
 */
export async function listPaymentsPageByContact(
  config: TenantConfig,
  contactAlegraId: string,
  { start, limit }: { start: number; limit: number },
): Promise<{ items: AlegraPayment[]; total: number }> {
  if (config.alegraMock) {
    const all = await listPaymentsByContact(config, contactAlegraId)
    return { items: all.slice(start, start + limit), total: all.length }
  }
  return fetchWindow(config, "/payments", mapRawPayment, {
    client_id: contactAlegraId,
    type: "in",
    order_field: "date",
    order_direction: "DESC",
  }, { start, limit, pageSize: limit })
}

export interface AlegraEstimateFilters {
  /** `billed` (facturado = aceptado) | `unbilled`. Probado: sí filtra (126 + 78 de 205). */
  status?: "billed" | "unbilled"
  /** Fecha de emisión desde/hasta, "YYYY-MM-DD". Probado: date_afterOrNow sí filtra. */
  dateFrom?: string
  dateTo?: string
}

/**
 * Presupuestos del contacto, del más reciente al más viejo.
 *
 * El orden explícito no es decorativo: sin `order_direction` Alegra devuelve del más VIEJO
 * al más nuevo (probado: 2018 → 2022). Y antes esto pedía una sola página de 30 sin total,
 * así que un cliente con 205 presupuestos veía 30 sin ningún aviso.
 */
export async function listEstimatesPageByContact(
  config: TenantConfig,
  contactAlegraId: string,
  { start, limit, filters = {} }: { start: number; limit: number; filters?: AlegraEstimateFilters },
): Promise<{ items: AlegraEstimate[]; total: number }> {
  if (config.alegraMock) {
    const all = await listEstimatesByContact(config, contactAlegraId)
    return { items: all.slice(start, start + limit), total: all.length }
  }
  return fetchWindow(config, "/estimates", mapRawEstimate, {
    client_id: contactAlegraId,
    order_field: "date",
    order_direction: "DESC",
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.dateFrom ? { date_afterOrNow: filters.dateFrom } : {}),
    ...(filters.dateTo ? { date_beforeOrNow: filters.dateTo } : {}),
  }, { start, limit })
}
