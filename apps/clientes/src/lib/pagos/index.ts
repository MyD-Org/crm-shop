/**
 * Registro de proveedores de pago. SOLO servidor.
 *
 * Sumar Mobbex o MODO es implementar `ProveedorPago` en un archivo nuevo y
 * agregar una línea acá. Nada del checkout ni de la ruta de pedidos se entera.
 */

import type { ProveedorPago } from "./tipos";
import { mercadoPago } from "./mercadopago";
import { payway } from "./payway";

const PROVEEDORES: Record<string, ProveedorPago> = {
  [mercadoPago.id]: mercadoPago,
  [payway.id]: payway,
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
  return Object.hasOwn(PROVEEDORES, id) ? PROVEEDORES[id] : null;
}

/** Ids de todos los proveedores registrados. */
export function idsProveedores(): string[] {
  return Object.keys(PROVEEDORES);
}

/**
 * ¿El procesador está registrado y con credenciales? Es lo que decide si un medio con cobro en línea
 * se ofrece: un procesador sin adaptador o sin credenciales no se muestra en el checkout.
 */
export function procesadorConfigurado(slug: string | null | undefined): boolean {
  return proveedorPago(slug)?.configurado() ?? false;
}

export * from "./tipos";
