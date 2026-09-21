/**
 * Registro de proveedores de pago. SOLO servidor.
 *
 * Sumar Mobbex o MODO es implementar `ProveedorPago` en un archivo nuevo y
 * agregar una línea acá. Nada del checkout ni de la ruta de pedidos se entera.
 */

import type { ProveedorPago } from "./tipos";
import { mercadoPago } from "./mercadopago";

const PROVEEDORES: Record<string, ProveedorPago> = {
  [mercadoPago.id]: mercadoPago,
};

/** Proveedor online por defecto del shop. */
export const PROVEEDOR_ACTIVO = mercadoPago.id;

/**
 * Busca un proveedor por id. Devuelve `null` en vez de tirar: un pedido viejo
 * puede referenciar un proveedor que ya no está configurado, y eso no debería
 * romper la pantalla donde el cliente mira su pedido.
 */
export function proveedorPago(id: string | null | undefined): ProveedorPago | null {
  if (!id) return null;
  return PROVEEDORES[id] ?? null;
}

export * from "./tipos";
