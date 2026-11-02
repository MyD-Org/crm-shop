// Tipos de los cupones de descuento en el Shop (spec apps/admin/docs/superpowers/specs/2026-11-01-cupones-design.md).
import type { OpcionCobro } from "../pagos/opciones-cobro";

/**
 * Foto del cupón que congela el pedido (`orders.cupon`, migración 0041). Lleva lo necesario para
 * recotizar (cambio de medio y cuotas) sin volver a leer la promoción: el pedido conserva su
 * descuento aunque la promoción se pause o venza. `descuento` es con IVA (la línea del resumen).
 */
export interface CuponPedido {
  codigoId: string;
  codigo: string;
  promocionId: string;
  nombre: string;
  pct: number | null;
  envioGratis: boolean;
  provinciasEnvio: string[] | null;
  medios: string[] | null;
  formas: OpcionCobro[] | null;
  permiteCuotas: boolean;
  condiciones: string;
  descuento: number;
}
