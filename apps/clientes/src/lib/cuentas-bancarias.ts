/**
 * Cuentas bancarias del Shop para pagos por transferencia (change `pago-transferencia-comprobante`,
 * rebanada B). Lógica PURA y tipos: la lectura de `public.cuentas_bancarias_shop` está en
 * `cuentas-bancarias-repo.ts` y la cacheada en `cuentas-bancarias-datos.ts`.
 *
 * Resolución: entre las cuentas ACTIVAS que cumplen sucursal y monto gana la de menor `orden`
 * (desempate estable por alias y luego id). Si ninguna cumple, la predeterminada activa. La
 * predeterminada es una cuenta como las demás: compite por `orden` si cumple sus reglas y además
 * es el respaldo. Sin ninguna, `null` ("Le enviaremos los datos para transferir").
 */

/** Slug fijo del medio de pago por transferencia: sólo ése lleva cuenta. */
export const SLUG_TRANSFERENCIA = "transferencia";

export interface CuentaBancaria {
  id: string;
  alias: string;
  cbu: string;
  banco: string;
  titular: string;
  cuit: string;
  /** Elección explícita "Todas las sucursales" (nunca un array vacío). */
  todasLasSucursales: boolean;
  sucursalSlugs: string[];
  /** NULL = sin límite. Inclusivo. */
  montoMin: number | null;
  montoMax: number | null;
  activa: boolean;
  predeterminada: boolean;
  orden: number;
}

export type MotivoCuenta = "regla" | "predeterminada";

export interface CuentaResuelta {
  cuenta: CuentaBancaria;
  motivo: MotivoCuenta;
}

export interface EntradaResolucion {
  /** Sucursal del pedido; `null` si no hay (flag apagado o sin zona resoluble). */
  sucursal: string | null;
  /** Total CON impuestos (`cotizacion.total`). */
  total: number;
}

/** Lo que se congela en `shop.orders.pago_cuenta` (v1). */
export interface CuentaPagoSnapshot {
  v: 1;
  cuentaId: string;
  alias: string;
  cbu: string;
  banco: string;
  titular: string;
  cuit: string;
  motivo: MotivoCuenta;
  sucursal: string | null;
  totalEvaluado: number;
  congeladaEn: string;
}

const centavos = (n: number): number => Math.round(n * 100);

function cumple(c: CuentaBancaria, e: EntradaResolucion): boolean {
  const sucursalOk =
    c.todasLasSucursales || (e.sucursal !== null && c.sucursalSlugs.includes(e.sucursal));
  if (!sucursalOk) return false;
  const total = centavos(e.total);
  if (c.montoMin !== null && total < centavos(c.montoMin)) return false;
  if (c.montoMax !== null && total > centavos(c.montoMax)) return false;
  return true;
}

function comparar(a: CuentaBancaria, b: CuentaBancaria): number {
  if (a.orden !== b.orden) return a.orden - b.orden;
  if (a.alias !== b.alias) return a.alias < b.alias ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export function resolverCuenta(
  cuentas: readonly CuentaBancaria[],
  entrada: EntradaResolucion,
): CuentaResuelta | null {
  const activas = cuentas.filter((c) => c.activa);
  const candidatas = activas.filter((c) => cumple(c, entrada)).sort(comparar);
  if (candidatas[0]) return { cuenta: candidatas[0], motivo: "regla" };
  const respaldo = activas.find((c) => c.predeterminada);
  return respaldo ? { cuenta: respaldo, motivo: "predeterminada" } : null;
}

export function armarSnapshotCuenta(
  resuelta: CuentaResuelta,
  entrada: EntradaResolucion,
  ahora: Date = new Date(),
): CuentaPagoSnapshot {
  const { cuenta, motivo } = resuelta;
  return {
    v: 1,
    cuentaId: cuenta.id,
    alias: cuenta.alias,
    cbu: cuenta.cbu,
    banco: cuenta.banco,
    titular: cuenta.titular,
    cuit: cuenta.cuit,
    motivo,
    sucursal: entrada.sucursal,
    totalEvaluado: entrada.total,
    congeladaEn: ahora.toISOString(),
  };
}
