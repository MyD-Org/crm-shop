/**
 * Traducción de lo que dice Payway a nuestro vocabulario. Módulo PURO: sin red, sin env, sin DB.
 *
 * Todo lo que sabemos de la API de Payway y que cambia el comportamiento vive acá, con su fuente
 * (la documentación oficial): los montos van en CENTAVOS enteros, el id con el que reconocemos un
 * pago es el `site_transaction_id` que mandamos nosotros, y un rechazo llega con el mismo cuerpo
 * de un pago.
 */

import type { EstadoPago, MotivoRechazo } from "./tipos";

/** Forma (parcial) del objeto de pago de Payway: sólo lo que leemos. Todo es opcional a propósito. */
export interface RespuestaPayway {
  id?: number | string;
  status?: string;
  /** En centavos: los dos últimos dígitos son decimales. */
  amount?: number;
  installments?: number;
  site_transaction_id?: string;
  status_details?: {
    error?: {
      type?: string;
      reason?: { id?: number | string; description?: string };
    } | null;
    ticket?: string | null;
  } | null;
}

/** Pesos a centavos enteros. Falla ruidoso con un monto que Payway rechazaría o que no es dinero. */
export function centavos(total: number): number {
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    throw new Error("Monto inválido para Payway.");
  }
  // toPrecision(12) quita el ruido de coma flotante (1,005 * 100 = 100,49999…) antes de redondear.
  const c = Math.round(Number((total * 100).toPrecision(12)));
  // Payway acepta 1..999999999999 (12 dígitos).
  if (!Number.isSafeInteger(c) || c < 1 || c > 999_999_999_999) {
    throw new Error("Monto fuera de rango para Payway.");
  }
  return c;
}

/**
 * `site_transaction_id` del intento: alfanumérico, máximo 40 caracteres y único por comercio. Es el
 * id del intento sin guiones (32 caracteres). Se conoce ANTES de llamar a Payway, y por eso sirve
 * para recuperarse de un timeout (consulta por `siteOperationId`).
 */
export function referenciaDeIntento(intentoId: string): string {
  const r = String(intentoId ?? "").replaceAll("-", "");
  if (!/^[a-z0-9]{1,40}$/i.test(r)) {
    throw new Error("El intento no sirve como site_transaction_id de Payway.");
  }
  return r;
}

/** Estados con los que el pago cuenta como cobrado. `approved_with_refund` es una devolución parcial. */
const COBRADOS = new Set(["approved", "accredited", "approved_with_refund"]);
/** Anulaciones y devoluciones totales: la plata se devolvió (equivale a `refunded` de MP). */
const REVERTIDOS = new Set(["annulled", "annulment_approved", "refunded", "refunded_approved"]);

const estadoDeStatus = (status: string): EstadoPago["estado"] => {
  if (COBRADOS.has(status)) return "pagado";
  if (REVERTIDOS.has(status) || status === "rejected") return "fallido";
  // pre_approved, process, review y cualquier estado que no conozcamos: nunca se asume cobrado.
  return "pendiente";
};

/**
 * Código de rechazo del autorizador (`status_details.error.reason.id`) a la categoría que decide
 * qué le decimos al comprador. Los de configuración del comercio (03, 12, 13, 30, 31, 57, 58, 89)
 * caen en `desconocido`: el comprador no puede arreglarlos y no se le explican.
 */
const MOTIVOS: Record<number, MotivoRechazo> = {
  51: "fondos",
  61: "limite",
  65: "limite",
  45: "cuotas_no_disponibles",
  48: "cuotas_no_disponibles",
  77: "cuotas_no_disponibles",
  14: "datos_invalidos",
  46: "datos_invalidos",
  49: "datos_invalidos",
  54: "datos_invalidos",
  5: "banco_rechazo",
  4: "banco_rechazo",
  7: "banco_rechazo",
  43: "banco_rechazo",
  53: "tarjeta_inhabilitada",
  56: "tarjeta_inhabilitada",
  1: "requiere_autorizacion",
  2: "requiere_autorizacion",
  76: "requiere_autorizacion",
  38: "demasiados_intentos",
};

export function motivoDeRechazo(reasonId: number | string | undefined | null): MotivoRechazo {
  const n = typeof reasonId === "string" ? Number.parseInt(reasonId, 10) : reasonId;
  if (typeof n !== "number" || !Number.isInteger(n)) return "desconocido";
  return MOTIVOS[n] ?? "desconocido";
}

/** Normaliza el status: Payway lo manda en minúscula, pero no dependemos de eso. */
const statusDe = (p: RespuestaPayway): string =>
  typeof p.status === "string" ? p.status.trim().toLowerCase() : "";

/**
 * Traduce un pago de Payway a nuestro vocabulario. Un solo lugar, así `crearPago` y
 * `consultarPago` no pueden divergir.
 */
export function interpretarPago(pago: RespuestaPayway): EstadoPago {
  const status = statusDe(pago);
  const estado = estadoDeStatus(status);
  const razon = pago.status_details?.error?.reason;

  const partes = [
    pago.id != null ? `payment_id=${pago.id}` : null,
    `status=${status || "desconocido"}`,
    pago.status_details?.error?.type === "cybersource_error" ? "error=cybersource" : null,
    razon?.id != null ? `reason=${razon.id}` : null,
    pago.status_details?.ticket ? `ticket=${pago.status_details.ticket}` : null,
  ].filter((p): p is string => p !== null);

  const amount = pago.amount;
  const cuotas = pago.installments;

  return {
    estado,
    // El id con el que reconocemos el pago es el que mandamos nosotros, no el payment_id numérico.
    referencia: pago.site_transaction_id ?? "",
    detalle: partes.join("; "),
    ...(status === "rejected"
      ? { motivo: pago.status_details?.error?.type === "cybersource_error" ? "control_seguridad" : motivoDeRechazo(razon?.id) }
      : {}),
    reversion: REVERTIDOS.has(status),
    cuotasPagadas: Number.isInteger(cuotas) && (cuotas as number) >= 1 ? cuotas : undefined,
    totalPagado:
      typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0 ? amount / 100 : undefined,
  };
}

/* ───────────────────────────── payment_method_id ───────────────────────────── */

export type ModalidadTarjeta = "credito" | "debito";

/**
 * Tabla oficial de Payway (crédito y débito). El id depende de la marca Y de la modalidad: Visa
 * crédito es 1 y Visa débito 31 comparten rango de BIN, así que el BIN solo no alcanza y el comprador
 * indica si paga con crédito o débito. Los medios offline y las prepagas no se ofrecen.
 */
const CREDITO: Record<string, number> = {
  visa: 1,
  amex: 65,
  mastercard: 104,
  cabal: 63,
  naranja: 24,
  diners: 8,
  nativa: 109,
  cencosud: 43,
  carrefour: 44,
  shopping: 23,
  argencard: 30,
  sol: 64,
  anonima: 61,
  tuya: 59,
};
const DEBITO: Record<string, number> = {
  visa: 31,
  mastercard: 105,
  maestro: 106,
  cabal: 108,
};

export function idMedioPago(marca: string, modalidad: ModalidadTarjeta): number | null {
  const tabla = modalidad === "debito" ? DEBITO : CREDITO;
  const k = String(marca ?? "").toLowerCase();
  return Object.hasOwn(tabla, k) ? tabla[k] : null;
}

const IDS_DEBITO = new Set(Object.values(DEBITO));
const IDS_PERMITIDOS = new Set([...Object.values(CREDITO), ...IDS_DEBITO]);

export const esDebito = (id: number): boolean => IDS_DEBITO.has(id);

/** Lista cerrada de `payment_method_id` que el servidor acepta del navegador. */
export function idsMedioPermitidos(): ReadonlySet<number> {
  return IDS_PERMITIDOS;
}
