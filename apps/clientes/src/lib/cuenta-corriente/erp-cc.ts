/**
 * Cuenta corriente del cliente: Alegra → tipos de dominio. SOLO servidor.
 *
 * Portado de apps/admin/src/lib/erp.ts (facturaEstado, presupuestoEstado,
 * map*, getCuenta, get*Page, getCondiciones), sin TenantConfig ni modo mock.
 * El contacto (razón social, CUIT, límite, plazo, vendedor, tipo de cuenta) sale
 * del ESPEJO del CRM (`contactos-espejo.ts`); los movimientos, de Alegra en vivo.
 *
 * `codigocliente` = id de contacto de Alegra, SIEMPRE de la identidad
 * (`identidadActual().cliente.codigocliente`), nunca del navegador.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmCondiciones } from "@/db/crm";
import { contactoPorId, type ContactoEspejo } from "../contactos-espejo";
import { shopTenantId } from "../tenant";
import {
  computeBalance,
  hoyArgentina,
  listEstimatesPageByContact,
  listInvoicesPageByContact,
  listOpenInvoicesByContact,
  listPaymentsPageByContact,
  type AlegraEstimateCC,
  type AlegraEstimateFilters,
  type AlegraInvoiceCC,
  type AlegraInvoiceFilters,
  type AlegraPaymentCC,
  type SaldoCC,
} from "./alegra-cc";
import type {
  Cliente,
  CondicionesComerciales,
  Cuenta,
  Factura,
  FacturaEstado,
  Pago,
  Presupuesto,
  PresupuestoEstado,
} from "./tipos";

/** Facturas por página: el máximo real de Alegra. */
export const FACTURAS_PAGE_SIZE = 30;
/** Pagos por página: 10 y no 30, cada pago trae sus imputaciones y 30 tardan ~9 s. */
export const PAGOS_PAGE_SIZE = 10;
/** Presupuestos por página: el máximo de Alegra, son livianos. */
export const PRESUPUESTOS_PAGE_SIZE = 30;

/** El contacto no está ni en el espejo ni en Alegra: la sección muestra su aviso. */
export class ContactoNoEncontradoError extends Error {
  constructor() {
    super("Contacto no encontrado");
    this.name = "ContactoNoEncontradoError";
  }
}

// ── Mapeos ──────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" → "DD/MM/YYYY". */
export function isoToDMY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * Estado visible de una factura. `hoy` = "YYYY-MM-DD" en Argentina.
 * Anulada primero (aunque Alegra le deje saldo); `open` con saldo 0 = pagada.
 */
export function facturaEstado(inv: Pick<AlegraInvoiceCC, "status" | "balance" | "dueDate">, hoy: string): FacturaEstado {
  if (inv.status === "void") return "anulada";
  if (inv.status === "closed" || inv.balance <= 0) return "pagada";
  if (inv.dueDate && inv.dueDate.slice(0, 10) < hoy) return "vencida";
  return "pendiente";
}

export function mapInvoice(inv: AlegraInvoiceCC, hoy: string): Factura {
  return {
    id: inv.number ?? inv.alegraId,
    alegraId: inv.alegraId,
    // Alegra no expone el tipo fiscal (A/B/C) de forma estándar en la factura de venta.
    tipo: "Factura",
    emision: isoToDMY(inv.date),
    vencimiento: inv.dueDate ? isoToDMY(inv.dueDate) : "",
    importe: inv.total,
    estado: facturaEstado(inv, hoy),
    pagado: inv.total - inv.balance,
  };
}

export function mapPayment(p: AlegraPaymentCC): Pago {
  return {
    id: p.number ?? p.alegraId,
    alegraId: p.alegraId,
    fecha: isoToDMY(p.date),
    medio: p.method,
    monto: p.amount,
    facturas: p.invoices.map((inv) => ({
      factura: inv.invoiceNumber ?? inv.invoiceAlegraId,
      imputado: inv.amount,
    })),
  };
}

/** `billed` = facturado = aceptado (se conservan las variantes viejas por si llegan). */
export function presupuestoEstado(e: Pick<AlegraEstimateCC, "status" | "dueDate">, hoy: string): PresupuestoEstado {
  const s = e.status.toLowerCase();
  if (s === "billed" || s.includes("accept") || s.includes("acept") || s.includes("invoic")) return "aceptado";
  if (e.dueDate && e.dueDate.slice(0, 10) < hoy) return "vencido";
  return "vigente";
}

export function mapEstimate(e: AlegraEstimateCC, hoy: string): Presupuesto {
  return {
    id: e.number ?? e.alegraId,
    alegraId: e.alegraId,
    fecha: isoToDMY(e.date),
    validoHasta: e.dueDate ? isoToDMY(e.dueDate) : "",
    total: e.total,
    estado: presupuestoEstado(e, hoy),
  };
}

export function mapCliente(c: ContactoEspejo, saldo?: SaldoCC): Cliente {
  return {
    codigocliente: c.alegraId,
    razonsocial: c.nombre,
    cuit: c.identificacion ?? "",
    email: c.email ?? undefined,
    tipoCuenta: c.tipoCuenta,
    limitecredito: c.limiteCredito,
    deudatotal: saldo?.total ?? 0,
    saldovencido: saldo?.overdue ?? 0,
    saldoavencer: saldo?.toFallDue ?? 0,
  };
}

/** Condiciones y barra de límite: sólo cuenta corriente según el espejo (decisión de paridad con el portal). */
export function esCuentaCorriente(cliente: Pick<Cliente, "tipoCuenta">): boolean {
  return cliente.tipoCuenta === "corriente";
}

/** ¿Se muestra la barra de límite/disponible? Cuenta corriente con límite > 0. */
export function muestraLimite(cliente: Pick<Cliente, "tipoCuenta" | "limitecredito">): boolean {
  return esCuentaCorriente(cliente) && (cliente.limitecredito ?? 0) > 0;
}

// ── Lecturas ────────────────────────────────────────────────────────────────

/**
 * Cliente con su saldo y sus abiertas, del MISMO pedido de abiertas: la tarjeta
 * de deuda y las listas de vencidas/a vencer no se pueden contradecir.
 */
export async function getCuenta(codigocliente: string): Promise<Cuenta> {
  const hoy = hoyArgentina();
  const [contacto, abiertas] = await Promise.all([
    contactoPorId(codigocliente),
    listOpenInvoicesByContact(codigocliente),
  ]);
  if (!contacto) throw new ContactoNoEncontradoError();
  return {
    cliente: mapCliente(contacto, computeBalance(abiertas, hoy)),
    // `open` con saldo 0 se mapea como "pagada": no es deuda y no entra acá.
    abiertas: abiertas
      .map((i) => mapInvoice(i, hoy))
      .filter((f) => f.estado === "pendiente" || f.estado === "vencida"),
  };
}

/**
 * Una página de facturas, de la más reciente a la más vieja. Los borradores no
 * se muestran NI se cuentan: el `total` de Alegra los incluye y se descuentan
 * los de esta ventana (un cliente con un solo borrador veía "1–0 de 1").
 */
export async function getFacturasPage(
  codigocliente: string,
  start = 0,
  limit = FACTURAS_PAGE_SIZE,
  filters: AlegraInvoiceFilters = {},
): Promise<{ facturas: Factura[]; total: number }> {
  const hoy = hoyArgentina();
  const { items, total } = await listInvoicesPageByContact(codigocliente, { start, limit, filters });
  const emitidas = items.filter((i) => i.status !== "draft");
  const ocultas = items.length - emitidas.length;
  return { facturas: emitidas.map((i) => mapInvoice(i, hoy)), total: Math.max(0, total - ocultas) };
}

export async function getPagosPage(
  codigocliente: string,
  start = 0,
  limit = PAGOS_PAGE_SIZE,
): Promise<{ pagos: Pago[]; total: number }> {
  const { items, total } = await listPaymentsPageByContact(codigocliente, { start, limit });
  return { pagos: items.map(mapPayment), total };
}

export async function getPresupuestosPage(
  codigocliente: string,
  start = 0,
  limit = PRESUPUESTOS_PAGE_SIZE,
  filters: AlegraEstimateFilters = {},
): Promise<{ presupuestos: Presupuesto[]; total: number }> {
  const hoy = hoyArgentina();
  const { items, total } = await listEstimatesPageByContact(codigocliente, { start, limit, filters });
  return { presupuestos: items.map((e) => mapEstimate(e, hoy)), total };
}

type CondicionesPropias = {
  condicionPago: string | null;
  plazoDias: number | null;
  listaPrecios: string | null;
  descuentos: CondicionesComerciales["descuentos"];
  vendedor: { nombre?: string; telefono?: string; email?: string } | null;
  transporte: { modalidad?: string; observaciones?: string } | null;
};

/** Fila de `client_commercial_conditions` del cliente, o `null`. Sin mock. */
async function getCondicionesPropias(codigocliente: string): Promise<CondicionesPropias | null> {
  const [row] = await getDb()
    .select({
      condicionPago: crmCondiciones.condicionPago,
      plazoDias: crmCondiciones.plazoDias,
      listaPrecios: crmCondiciones.listaPrecios,
      descuentos: crmCondiciones.descuentos,
      vendedor: crmCondiciones.vendedor,
      transporte: crmCondiciones.transporte,
    })
    .from(crmCondiciones)
    .where(and(eq(crmCondiciones.tenantId, shopTenantId()), eq(crmCondiciones.codigocliente, codigocliente)))
    .limit(1);
  if (!row) return null;
  return {
    condicionPago: row.condicionPago || null,
    plazoDias: row.plazoDias,
    listaPrecios: row.listaPrecios || null,
    descuentos: Array.isArray(row.descuentos) ? row.descuentos : [],
    vendedor: row.vendedor ?? null,
    transporte: row.transporte ?? null,
  };
}

/**
 * Condiciones comerciales: lo que Alegra tiene en la ficha (espejo) manda; la
 * tabla propia aporta descuentos, transporte y teléfono/email del vendedor.
 * Nunca datos de ejemplo. Sólo se muestra a cuenta corriente (lo decide la UI).
 * `contacto`: el que ya leyó quien llama (la página de Condiciones lo necesita
 * para decidir si la muestra); sin él se lee acá.
 */
export async function getCondiciones(
  codigocliente: string,
  contactoLeido?: ContactoEspejo | null,
): Promise<CondicionesComerciales> {
  const [contacto, propias] = await Promise.all([
    contactoLeido === undefined ? contactoPorId(codigocliente) : contactoLeido,
    getCondicionesPropias(codigocliente),
  ]);
  const vendedorNombre = contacto?.vendedor ?? propias?.vendedor?.nombre ?? null;
  return {
    condicionPago: contacto?.plazoNombre ?? propias?.condicionPago ?? null,
    plazoDias: contacto?.plazoDias ?? propias?.plazoDias ?? null,
    listaPrecios: contacto?.listaPrecios ?? propias?.listaPrecios ?? null,
    descuentos: propias?.descuentos ?? [],
    vendedor: vendedorNombre
      ? {
          nombre: vendedorNombre,
          telefono: propias?.vendedor?.telefono || null,
          email: propias?.vendedor?.email || null,
        }
      : null,
    transporte: propias?.transporte?.modalidad
      ? { modalidad: propias.transporte.modalidad, observaciones: propias.transporte.observaciones ?? "" }
      : null,
  };
}
