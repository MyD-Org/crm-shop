/**
 * Tipos de dominio de la cuenta corriente del cliente en Mi cuenta.
 * Portado de apps/admin/src/types/index.ts (Cliente, Factura, Pago, Presupuesto,
 * CondicionesComerciales), para que la UI del portal y la del Shop hablen igual.
 */

export type FacturaEstado = "pendiente" | "vencida" | "pagada" | "anulada";

export interface Factura {
  /** Número legible (ej. "FV-1-000128"); si Alegra no lo trae, el id. */
  id: string;
  tipo: string;
  /** "DD/MM/YYYY". */
  emision: string;
  /** "DD/MM/YYYY" o "" si no tiene. */
  vencimiento: string;
  importe: number;
  estado: FacturaEstado;
  /** Monto ya pagado: si es > 0 y < importe, la factura tiene pago parcial. */
  pagado?: number;
  /** Id del documento en Alegra: el que sirve para pedir el PDF. */
  alegraId: string;
}

export interface PagoImputacion {
  factura: string;
  imputado: number;
}

export interface Pago {
  id: string;
  fecha: string;
  /** Facturas canceladas (total o parcialmente) con este pago. */
  facturas: PagoImputacion[];
  medio: string;
  monto: number;
  alegraId: string;
}

export type PresupuestoEstado = "vigente" | "vencido" | "aceptado";

export interface Presupuesto {
  id: string;
  fecha: string;
  validoHasta: string;
  total: number;
  estado: PresupuestoEstado;
  alegraId: string;
}

/** Cliente con su saldo. Los datos del contacto salen del espejo del CRM. */
export interface Cliente {
  codigocliente: string;
  razonsocial: string;
  cuit: string;
  email?: string;
  tipoCuenta: "corriente" | "contado";
  /** `null` = no cargado: la UI no muestra barra de crédito. */
  limitecredito: number | null;
  deudatotal: number;
  saldovencido: number;
  saldoavencer: number;
}

export interface Cuenta {
  cliente: Cliente;
  /** Facturas impagas (pendientes y vencidas), COMPLETAS: de acá salen el saldo y sus listas. */
  abiertas: Factura[];
}

/**
 * Condiciones comerciales. Alegra (espejo): condición/plazo, lista de precios y
 * vendedor. Tabla propia del CRM: descuentos, transporte y teléfono/email del
 * vendedor. Todo nullable: lo que no está cargado se esconde. Sin datos de
 * ejemplo nunca.
 */
export interface CondicionesComerciales {
  condicionPago: string | null;
  /** `null` si no está cargado; 0 es "de contado". */
  plazoDias: number | null;
  listaPrecios: string | null;
  descuentos: { concepto: string; porcentaje: number }[];
  vendedor: { nombre: string; telefono: string | null; email: string | null } | null;
  transporte: { modalidad: string; observaciones: string } | null;
}
