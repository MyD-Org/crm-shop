// Textos del cupón en la tienda (carrito, checkout, aviso del link). Puro y en usted.
import { fmtPrecio } from "../format";

/** Aviso al llegar con `?cupon=` (link del bot o de una historia). */
export function avisoCuponGuardado(cupon: string): string {
  return `Cupón ${cupon.trim().toUpperCase()} guardado: se aplica en el checkout.`;
}

const OFFSET_AR_MS = -3 * 3_600_000;
const AVISO_VENCE_MS = 48 * 3_600_000;

/** La línea del resumen: "Cupón LUZ-7KQ2M (10 %)"; sin el % si no alcanzó ninguna línea. */
export function textoLineaCupon(c: { codigo: string; pct: number | null; pctAplicado: boolean }): string {
  return c.pct !== null && c.pctAplicado ? `Cupón ${c.codigo} (${c.pct} %)` : `Cupón ${c.codigo}`;
}

/** "Su cupón vence el 12/11 a las 23:59." si faltan menos de 48 h (hora de Argentina); si no, null. */
export function avisoVencimiento(venceEn: string | null, ahora: Date): string | null {
  if (!venceEn) return null;
  const falta = new Date(venceEn).getTime() - ahora.getTime();
  if (!(falta > 0 && falta < AVISO_VENCE_MS)) return null;
  const local = new Date(new Date(venceEn).getTime() + OFFSET_AR_MS).toISOString();
  return `Su cupón vence el ${local.slice(8, 10)}/${local.slice(5, 7)} a las ${local.slice(11, 16)}.`;
}

/**
 * Subtotal e impuestos del resumen ANTES del cupón (las líneas también se ven sin él): así se lee
 * subtotal + impuestos − cupón = total, sin descontar dos veces. Sin cupón, los de la cotización.
 */
export function montosAntesDelCupon(c: {
  subtotal: number;
  iva: number;
  costoEnvio: number;
  total: number;
  cupon?: { descuento: number; subtotalAntes: number } | null;
}): { subtotal: number; iva: number } {
  if (!c.cupon) return { subtotal: c.subtotal, iva: c.iva };
  const subtotal = c.cupon.subtotalAntes;
  return { subtotal, iva: Math.round((c.total + c.cupon.descuento - subtotal - c.costoEnvio) * 100) / 100 };
}

/** Cambio de medio de un pedido con cupón a una opción no elegible: se avisa con los dos totales. */
export function textoCuponNoAplicaEnCambio(opcion: string, totalActual: number, totalNuevo: number): string {
  return `Con ${opcion} el cupón no aplica: el total pasa de ${fmtPrecio(totalActual)} a ${fmtPrecio(totalNuevo)}.`;
}
