/**
 * Cuotas en el cobro. Puro: lo usan la ruta de pago y el registro del cobro, y se testea sin red ni DB.
 *
 * Tres caminos legítimos (todo lo demás es `cuotas_distintas`):
 * - 1 pago: pedido en 1 pago o sin cuotas congeladas.
 * - Sin interés de la tienda: las cuotas congeladas en el pedido (cada cantidad es otra lista de
 *   precios, así que es IGUALDAD estricta), con una tarjeta de las marcas de esa condición.
 * - Con interés de Mercado Pago: pedido en 1 pago (o sin congelar), tarjeta de crédito y una cantidad
 *   que MP ofrece para el BIN de la tarjeta (consultado en el servidor: `requierePlanesMP` dice cuándo).
 *   El monto sigue siendo el total del pedido; el interés lo agrega MP. Si MP no responde, no se acepta.
 *
 * El control de que MP no cobre interés en una cuota "sin interés" de la tienda no se hace acá: el
 * cobro sin interés no consulta a MP; si igual lo cobró, la reconciliación lo marca (`monto_distinto`).
 */
import type { PagoMedio } from "./tipos";
import { marcaPermitida } from "./marcas";
import type { OpcionCobro } from "./opciones-cobro";
import type { ResultadoPlanesMP } from "./mercadopago-planes";

export const CUOTAS_MAX_COBRO = 24;

export interface EntradaValidacionCuotas {
  /** Lo que mandó el navegador (cuotas del formulario de pago). No confiable. */
  cuotas: unknown;
  medio: PagoMedio;
  /** Cuotas congeladas en el pedido (1 = un pago). null = pedido sin cuotas congeladas. */
  cuotasPedido: number | null;
  procesadorId: string;
  /** Forma de pago del cobro (crédito, débito, cuenta de Mercado Pago). */
  opcion: OpcionCobro;
  /** Marca canónica de la tarjeta (`pagos/marcas.ts`); null = desconocida o sin tarjeta. */
  marca: string | null;
  /** Marcas de la condición de las cuotas congeladas (null = todas). */
  marcasCondicion: readonly string[] | null | undefined;
  /** Monto que se le manda al procesador: el total del pedido. */
  totalPedido: number;
  /** Planes de MP para la tarjeta; null = no se consultaron. Ver `requierePlanesMP`. */
  planes: ResultadoPlanesMP | null;
}

export type MotivoCuotas = "cuotas_distintas" | "marca_no_permitida" | "planes_no_disponibles" | "cuotas_no_disponibles";

export type ResultadoValidacionCuotas =
  | { ok: true; cuotas: number; intencion: IntencionCobro }
  | { ok: false; motivo: MotivoCuotas };

/** Cuotas pedidas: ausente = 1; null si no es un entero de 1 a 24. */
function cuotasPedidas(cuotas: unknown): number | null {
  const n = cuotas === undefined ? 1 : cuotas;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= CUOTAS_MAX_COBRO ? n : null;
}

const enUnPago = (cuotasPedido: number | null) => cuotasPedido === null || cuotasPedido === 1;

/**
 * ¿Este cobro va por el camino con interés de Mercado Pago? Ahí (y sólo ahí) la ruta consulta los
 * planes a MP con el BIN antes de validar.
 */
export function requierePlanesMP(e: Omit<EntradaValidacionCuotas, "planes">): boolean {
  const n = cuotasPedidas(e.cuotas);
  return n !== null && n >= 2 && enUnPago(e.cuotasPedido) && e.procesadorId === "mercadopago" && e.opcion === "credito";
}

export function validarCuotasPago(e: EntradaValidacionCuotas): ResultadoValidacionCuotas {
  const n = cuotasPedidas(e.cuotas);
  if (n === null) return { ok: false, motivo: "cuotas_distintas" };
  const intencion = (conInteres: boolean): IntencionCobro => ({ cuotas: n, totalEsperado: e.totalPedido, conInteres });

  if (n === 1) {
    return enUnPago(e.cuotasPedido) ? { ok: true, cuotas: 1, intencion: intencion(false) } : { ok: false, motivo: "cuotas_distintas" };
  }

  if (n === e.cuotasPedido) {
    if (!marcaPermitida(e.marcasCondicion, e.marca)) return { ok: false, motivo: "marca_no_permitida" };
    return { ok: true, cuotas: n, intencion: intencion(false) };
  }

  if (!enUnPago(e.cuotasPedido)) return { ok: false, motivo: "cuotas_distintas" };
  if (e.procesadorId !== "mercadopago" || e.opcion !== "credito") return { ok: false, motivo: "cuotas_no_disponibles" };
  if (!e.planes || !e.planes.ok) return { ok: false, motivo: "planes_no_disponibles" };
  if (!e.planes.entrada) return { ok: false, motivo: "cuotas_no_disponibles" };
  const plan = e.planes.entrada.planes.find((p) => p.cuotas === n);
  if (!plan) return { ok: false, motivo: "cuotas_distintas" };
  return { ok: true, cuotas: n, intencion: intencion(plan.conInteres) };
}

/** Motivo por el que un operador revisa el cobro en cuotas (ver `orders.pago_revision`). */
export type RevisionDeCuotas = "cuotas_distintas" | "monto_distinto";

/** Tolerancia de redondeo entre lo congelado y lo informado: un centavo. */
const TOLERANCIA_MONTO = 0.0105;

/**
 * Lo que se le pidió al procesador en un intento (`pago_intentos`, migración 0034). Lo escribe la ruta de
 * cobro al reservar el intento; la reconciliación lo usa para distinguir un cobro con interés que el
 * comprador ELIGIÓ de uno que no.
 */
export interface IntencionCobro {
  /** Cuotas pedidas al procesador. */
  cuotas: number;
  /** Monto mandado al procesador: el total del pedido (con interés, el precio de 1 pago). */
  totalEsperado: number;
  /** true = cuotas con interés del procesador: el comprador paga más que `totalEsperado`. */
  conInteres: boolean;
}

/**
 * Reconciliación: lo que informó el procesador contra lo esperado. Sólo se acusa lo que el procesador
 * informó.
 *
 * - Con intención (intento reservado por la ruta de cobro): se compara contra lo pedido. Con interés, el
 *   total pagado puede ser MAYOR (el interés lo cobra el procesador); menor es discrepancia, con una
 *   tolerancia de un centavo por cuota (redondeo de cada cuota).
 * - Sin intención (intento anterior a la 0034 o recuperado por el webhook): contra lo congelado en el
 *   pedido; un pedido sin cuotas congeladas nunca se revisa por esto.
 */
export function revisionDeCuotas(
  pedido: { cuotas: number | null; total: number },
  cobro: { cuotas?: number; totalPagado?: number },
  intencion: IntencionCobro | null = null,
): RevisionDeCuotas | null {
  if (intencion) {
    if (typeof cobro.cuotas === "number" && cobro.cuotas !== intencion.cuotas) return "cuotas_distintas";
    if (typeof cobro.totalPagado !== "number") return null;
    if (intencion.conInteres) {
      const tolerancia = Math.max(TOLERANCIA_MONTO, 0.01 * intencion.cuotas);
      return cobro.totalPagado < intencion.totalEsperado - tolerancia ? "monto_distinto" : null;
    }
    return Math.abs(cobro.totalPagado - intencion.totalEsperado) > TOLERANCIA_MONTO ? "monto_distinto" : null;
  }
  if (pedido.cuotas === null) return null;
  if (typeof cobro.cuotas === "number" && cobro.cuotas !== pedido.cuotas) return "cuotas_distintas";
  if (typeof cobro.totalPagado === "number" && Math.abs(cobro.totalPagado - pedido.total) > TOLERANCIA_MONTO) {
    return "monto_distinto";
  }
  return null;
}
