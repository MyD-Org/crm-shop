/**
 * Qué formas de pago muestran los formularios de cobro en línea según el admin (migración 0073 del
 * CRM). Puro, para poder probarlo sin montar el SDK de cada procesador. El servidor igual rechaza una
 * forma deshabilitada (`rechazoPorOpcionDeCobro`).
 */
import type { OpcionCobro } from "@/lib/pagos/opciones-cobro";

/** Opciones de "¿Cómo quiere pagar?" de Mercado Pago, en el orden en que se muestran. */
export type OpcionMercadoPago = "credito" | "debito" | "cuenta";

const FORMA_DE_OPCION_MP: Readonly<Record<OpcionMercadoPago, OpcionCobro>> = {
  credito: "credito",
  debito: "debito",
  cuenta: "cuenta_mp",
};

/** La forma de pago (la de las listas de precios) que corresponde a una opción de Mercado Pago. */
export function formaDeOpcionMercadoPago(opcion: OpcionMercadoPago): OpcionCobro {
  return FORMA_DE_OPCION_MP[opcion];
}

/** La opción de Mercado Pago de una forma de pago, si está entre las habilitadas; si no, `null`. */
export function opcionDeFormaMercadoPago(
  forma: OpcionCobro | null | undefined,
  habilitadas: readonly OpcionMercadoPago[],
): OpcionMercadoPago | null {
  return habilitadas.find((o) => FORMA_DE_OPCION_MP[o] === forma) ?? null;
}

/** Las opciones de Mercado Pago habilitadas, en su orden. Sin dato, todas. */
export function opcionesMercadoPagoHabilitadas(opcionesCobro: readonly OpcionCobro[] | undefined): OpcionMercadoPago[] {
  return (Object.keys(FORMA_DE_OPCION_MP) as OpcionMercadoPago[]).filter(
    (o) => opcionesCobro === undefined || opcionesCobro.includes(FORMA_DE_OPCION_MP[o]),
  );
}

/** Modalidades de tarjeta de Payway habilitadas (Payway ignora la cuenta de Mercado Pago). Sin dato, las dos. */
export function modalidadesPaywayHabilitadas(opcionesCobro: readonly OpcionCobro[] | undefined): ("credito" | "debito")[] {
  return (["credito", "debito"] as const).filter((m) => opcionesCobro === undefined || opcionesCobro.includes(m));
}
