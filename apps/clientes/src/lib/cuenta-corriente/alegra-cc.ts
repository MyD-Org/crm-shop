/**
 * Lecturas de Alegra para la cuenta corriente del cliente (facturas, pagos,
 * presupuestos, facturas abiertas para el saldo y PDF). SOLO servidor.
 *
 * Portado de apps/admin/src/lib/alegra.ts (fetchWindow, list*PageByContact,
 * listOpenInvoicesByContact, computeBalance, getDocumentPdf, mapRaw*), sin
 * TenantConfig ni modo mock: el Shop tiene UNA cuenta de Alegra (envs
 * `ALEGRA_*`) y pasa por `apiFetch` de `lib/alegra.ts` (reintentos ante 429).
 *
 * Todo listado filtra por `client_id` = el contacto de la identidad: quien
 * llama nunca pasa un id que venga del navegador.
 */
import { apiFetch, esIdAlegra, type QueryParams } from "../alegra";

/** Alegra topea `limit` en 30: pedir más no falla, devuelve basura (con 100 vuelven 2 filas). */
const PAGE_SIZE = 30;

export interface AlegraInvoiceCC {
  alegraId: string;
  /** fullNumber legible (ej. "FV-1-00012876") si Alegra lo trae. */
  number: string | null;
  /** Emisión, YYYY-MM-DD. */
  date: string;
  /** Vencimiento, YYYY-MM-DD. */
  dueDate: string | null;
  total: number;
  /** Saldo pendiente (0 = pagada). */
  balance: number;
  /** open | closed | draft | void */
  status: string;
  clientAlegraId: string;
}

export interface AlegraPaymentCC {
  alegraId: string;
  number: string | null;
  date: string;
  amount: number;
  /** paymentMethod (Transferencia, Efectivo, …). */
  method: string;
  invoices: { invoiceAlegraId: string; invoiceNumber: string | null; amount: number }[];
}

export interface AlegraEstimateCC {
  alegraId: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  clientAlegraId: string;
  /** Alegra: billed (facturado = aceptado) | unbilled. */
  status: string;
  total: number;
}

export interface SaldoCC {
  /** Deuda total: suma de saldos de las abiertas. */
  total: number;
  /** Vencido: vencimiento anterior a hoy. */
  overdue: number;
  /** A vencer: el resto. */
  toFallDue: number;
}

export interface AlegraInvoiceFilters {
  /** `open` | `closed` | `void`. Alegra no acepta varios a la vez. */
  status?: "open" | "closed" | "void";
  /** Fecha de EMISIÓN desde/hasta, "YYYY-MM-DD". El vencimiento no se puede filtrar en Alegra. */
  dateFrom?: string;
  dateTo?: string;
}

export interface AlegraEstimateFilters {
  status?: "billed" | "unbilled";
  dateFrom?: string;
  dateTo?: string;
}

// ── Mapeos (portados tal cual) ──────────────────────────────────────────────

function numeroLegible(raw: Record<string, unknown>): string | null {
  const numberTemplate = raw.numberTemplate as { fullNumber?: unknown; formattedNumber?: unknown } | undefined;
  const full = numberTemplate?.fullNumber ?? numberTemplate?.formattedNumber ?? raw.number;
  return full != null ? String(full) : null;
}

function idCliente(raw: Record<string, unknown>): string {
  const client = (raw.client ?? {}) as Record<string, unknown>;
  return client.id != null ? String(client.id) : "";
}

export function mapRawInvoice(raw: Record<string, unknown>): AlegraInvoiceCC {
  return {
    alegraId: String(raw.id),
    number: numeroLegible(raw),
    date: String(raw.date ?? ""),
    dueDate: raw.dueDate ? String(raw.dueDate) : null,
    total: Number(raw.total ?? 0),
    balance: Number(raw.balance ?? 0),
    status: String(raw.status ?? "open"),
    clientAlegraId: idCliente(raw),
  };
}

export function mapRawPayment(raw: Record<string, unknown>): AlegraPaymentCC {
  const method = raw.paymentMethod as { name?: unknown } | string | undefined;
  const invoicesRaw = Array.isArray(raw.invoices) ? (raw.invoices as Record<string, unknown>[]) : [];
  return {
    alegraId: String(raw.id),
    number: raw.number != null ? String(raw.number) : null,
    date: String(raw.date ?? ""),
    amount: Number(raw.amount ?? 0),
    method:
      typeof method === "string"
        ? method
        : method?.name != null
          ? String(method.name)
          : String(raw.paymentMethod ?? ""),
    invoices: invoicesRaw.map((inv) => {
      const numberTemplate = inv.numberTemplate as { fullNumber?: unknown } | undefined;
      return {
        invoiceAlegraId: String(inv.id),
        invoiceNumber:
          numberTemplate?.fullNumber != null
            ? String(numberTemplate.fullNumber)
            : inv.number != null
              ? String(inv.number)
              : null,
        // Alegra devuelve el monto imputado en `amount` dentro de cada factura del pago.
        amount: Number(inv.amount ?? 0),
      };
    }),
  };
}

export function mapRawEstimate(raw: Record<string, unknown>): AlegraEstimateCC {
  return {
    alegraId: String(raw.id),
    number: raw.number != null ? String(raw.number) : null,
    date: String(raw.date ?? ""),
    dueDate: raw.dueDate ? String(raw.dueDate) : null,
    clientAlegraId: idCliente(raw),
    status: String(raw.status ?? ""),
    total: Number(raw.total ?? 0),
  };
}

// ── Ventanas paginadas ──────────────────────────────────────────────────────

/**
 * Una ventana [start, start+limit) de un listado de Alegra, con el total.
 *
 * `metadata=true` sólo en el primer pedido: la respuesta pasa a ser
 * `{ metadata: { total }, data }`; sin él, el array pelado. Una ventana mayor a
 * 30 se arma con varios pedidos de a 30 en paralelo. `pageSize` más chico para
 * pagos: cada uno trae sus imputaciones y 30 tardan ~9 s.
 */
export async function fetchWindow<T>(
  path: string,
  map: (raw: Record<string, unknown>) => T,
  params: QueryParams,
  { start, limit, pageSize = PAGE_SIZE }: { start: number; limit: number; pageSize?: number },
): Promise<{ items: T[]; total: number }> {
  const size = Math.max(1, Math.min(pageSize, PAGE_SIZE));
  const chunks = Math.max(1, Math.ceil(limit / size));
  const responses = await Promise.all(
    Array.from({ length: chunks }, (_, i) =>
      apiFetch<unknown>(path, {
        ...params,
        start: start + i * size,
        limit: Math.min(size, limit - i * size),
        ...(i === 0 ? { metadata: "true" } : {}),
      }),
    ),
  );
  let total = 0;
  const items: T[] = [];
  responses.forEach((res, i) => {
    const rows = Array.isArray(res)
      ? (res as Record<string, unknown>[])
      : (((res as { data?: unknown } | null)?.data as Record<string, unknown>[] | undefined) ?? []);
    if (i === 0 && !Array.isArray(res)) {
      total = Number((res as { metadata?: { total?: unknown } } | null)?.metadata?.total ?? 0);
    }
    for (const row of rows) items.push(map(row));
  });
  return { items, total };
}

const ORDEN_RECIENTE = { order_field: "date", order_direction: "DESC" } as const;

export function listInvoicesPageByContact(
  contactAlegraId: string,
  { start, limit, filters = {} }: { start: number; limit: number; filters?: AlegraInvoiceFilters },
) {
  return fetchWindow(
    "/invoices",
    mapRawInvoice,
    {
      client_id: contactAlegraId,
      ...ORDEN_RECIENTE,
      status: filters.status,
      date_afterOrNow: filters.dateFrom,
      date_beforeOrNow: filters.dateTo,
    },
    { start, limit },
  );
}

/** Pagos recibidos (type=in). Alegra IGNORA los filtros de fecha en pagos: no se ofrecen. */
export function listPaymentsPageByContact(
  contactAlegraId: string,
  { start, limit }: { start: number; limit: number },
) {
  return fetchWindow(
    "/payments",
    mapRawPayment,
    { client_id: contactAlegraId, type: "in", ...ORDEN_RECIENTE },
    { start, limit, pageSize: limit },
  );
}

/** Presupuestos. Sin `order_direction` Alegra devuelve del más VIEJO al más nuevo. */
export function listEstimatesPageByContact(
  contactAlegraId: string,
  { start, limit, filters = {} }: { start: number; limit: number; filters?: AlegraEstimateFilters },
) {
  return fetchWindow(
    "/estimates",
    mapRawEstimate,
    {
      client_id: contactAlegraId,
      ...ORDEN_RECIENTE,
      status: filters.status,
      date_afterOrNow: filters.dateFrom,
      date_beforeOrNow: filters.dateTo,
    },
    { start, limit },
  );
}

/**
 * TODAS las facturas abiertas del contacto: de acá sale el saldo, no de una
 * página. Es un set chico (un cliente con 1282 facturas tiene ~10 abiertas); se
 * pide de a 30, secuencial, hasta una página incompleta. Alegra no tiene
 * endpoint de saldo.
 */
export async function listOpenInvoicesByContact(contactAlegraId: string): Promise<AlegraInvoiceCC[]> {
  const out: AlegraInvoiceCC[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const page = await apiFetch<Record<string, unknown>[]>("/invoices", {
      client_id: contactAlegraId,
      status: "open",
      start,
      limit: PAGE_SIZE,
    });
    if (!Array.isArray(page) || page.length === 0) break;
    for (const row of page) out.push(mapRawInvoice(row));
    if (page.length < PAGE_SIZE) break;
  }
  return out;
}

// ── Saldo ───────────────────────────────────────────────────────────────────

/** "Hoy" en Argentina como "YYYY-MM-DD": el servidor corre en UTC. */
export function hoyArgentina(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

/**
 * Saldo a partir de las facturas abiertas: vencido (vence antes de hoy) vs. a
 * vencer. Cerradas, anuladas y abiertas con saldo 0 no son deuda.
 */
export function computeBalance(invoices: AlegraInvoiceCC[], hoy: string = hoyArgentina()): SaldoCC {
  let total = 0;
  let overdue = 0;
  for (const inv of invoices) {
    if (inv.status === "closed" || inv.status === "void" || inv.status === "draft" || inv.balance <= 0) continue;
    total += inv.balance;
    if (inv.dueDate && inv.dueDate.slice(0, 10) < hoy) overdue += inv.balance;
  }
  return { total, overdue, toFallDue: total - overdue };
}

// ── PDF ─────────────────────────────────────────────────────────────────────

/** Tipos de documento de Mi cuenta y su recurso en Alegra. */
export const DOCUMENT_RESOURCES = {
  factura: "invoices",
  pago: "payments",
  presupuesto: "estimates",
} as const;

export type DocumentKind = keyof typeof DOCUMENT_RESOURCES;

export function esDocumentKind(v: unknown): v is DocumentKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(DOCUMENT_RESOURCES, v);
}

export interface AlegraDocumentPdf {
  /** Contacto dueño. `null` si Alegra no lo trae (⇒ tratar como ajeno). */
  clientAlegraId: string | null;
  /** URL firmada del PDF: NUNCA sale del servidor. `null` si Alegra no generó uno. */
  pdfUrl: string | null;
  number: string | null;
}

/**
 * Documento con su PDF firmado y el contacto dueño, para validar pertenencia
 * ANTES de servirlo. No filtra por cliente: eso lo hace quien llama. Id
 * inválido o inexistente ⇒ `null`.
 */
export async function getDocumentPdf(kind: DocumentKind, documentId: string): Promise<AlegraDocumentPdf | null> {
  if (!esIdAlegra(documentId) || !esDocumentKind(kind)) return null;
  let raw: Record<string, unknown> | null;
  try {
    raw = await apiFetch<Record<string, unknown> | null>(
      `/${DOCUMENT_RESOURCES[kind]}/${encodeURIComponent(documentId)}`,
      { fields: "pdf" },
    );
  } catch (err) {
    if (err instanceof Error && /^Alegra 404 /.test(err.message)) return null;
    throw err;
  }
  if (!raw || raw.id == null) return null;
  const client = (raw.client ?? {}) as Record<string, unknown>;
  return {
    clientAlegraId: client.id != null ? String(client.id) : null,
    pdfUrl: typeof raw.pdf === "string" && raw.pdf ? raw.pdf : null,
    number: numeroLegible(raw),
  };
}

/** ¿El error es un 429 de Alegra que sobrevivió a los reintentos? (las API responden 503). */
export function esLimiteAlegra(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Alegra a veces "disfraza" el límite: 400 con {"code":429} en el cuerpo.
  return /^Alegra 429 /.test(err.message) || /^Alegra 400 [^]*"code"\s*:\s*429/.test(err.message);
}
