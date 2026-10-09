/**
 * Registro de proveedores de pago. SOLO servidor.
 *
 * Sumar Mobbex o MODO es implementar `ProveedorPago` en un archivo nuevo y
 * agregar una línea acá. Nada del checkout ni de la ruta de pedidos se entera.
 *
 * Cada procesador tiene una cuenta por sucursal: no hay singletons. `proveedorPago(id, cuenta)` devuelve
 * un proveedor LIGADO a esa cuenta (sus credenciales y ninguna otra). La cuenta es obligatoria en el
 * tipo: olvidarla es un error de compilación (y una guarda de `credenciales.test.ts`).
 */

import type { ProveedorPago } from "./tipos";
import { hayCuentaConfigurada } from "./credenciales";
import { crearMercadoPago } from "./mercadopago";
import { crearPayway } from "./payway";

/** Lo que se sabe de un procesador sin elegir cuenta (la ruta lo necesita antes de leer el pedido). */
export interface RasgosProcesador {
  /** Exige el BIN de la tarjeta (6 dígitos) en el cobro. */
  requiereBin: boolean;
  /** Manda los datos del pedido a un control de fraude. */
  requiereAntifraude: boolean;
  /** Avisa por webhook (implementa `verificarWebhook`). */
  conWebhook: boolean;
}

const PROCESADORES: Record<string, RasgosProcesador & { crear: (cuenta: string) => ProveedorPago }> = {
  mercadopago: { crear: crearMercadoPago, requiereBin: false, requiereAntifraude: false, conWebhook: true },
  payway: { crear: (cuenta) => crearPayway({ cuenta }), requiereBin: true, requiereAntifraude: true, conWebhook: false },
};

/** Proveedor online por defecto del shop. */
export const PROVEEDOR_ACTIVO = "mercadopago";

const instancias = new Map<string, ProveedorPago>();

/**
 * Proveedor `id` ligado a `cuenta` (memoizado por `id|cuenta`). Devuelve `null` en vez de tirar si el
 * procesador no está registrado: un pedido viejo puede referenciar uno que ya no existe, y eso no
 * debería romper la pantalla donde el cliente mira su pedido.
 */
export function proveedorPago(id: string | null | undefined, cuenta: string): ProveedorPago | null {
  if (!id || !Object.hasOwn(PROCESADORES, id)) return null;
  const clave = `${id}|${cuenta}`;
  let p = instancias.get(clave);
  if (!p) {
    p = PROCESADORES[id].crear(cuenta);
    instancias.set(clave, p);
  }
  return p;
}

/** Rasgos del procesador, o null si no está registrado. */
export function rasgosProcesador(id: string | null | undefined): RasgosProcesador | null {
  if (!id || !Object.hasOwn(PROCESADORES, id)) return null;
  const { requiereBin, requiereAntifraude, conWebhook } = PROCESADORES[id];
  return { requiereBin, requiereAntifraude, conWebhook };
}

/** Ids de todos los proveedores registrados. */
export function idsProveedores(): string[] {
  return Object.keys(PROCESADORES);
}

/**
 * ¿El procesador está registrado y tiene AL MENOS una cuenta con credenciales completas? Es lo que
 * decide si un medio con cobro en línea se ofrece. Sincrónica y sin base (no dice cuál cuenta).
 */
export function procesadorConfigurado(slug: string | null | undefined): boolean {
  if (!slug || !Object.hasOwn(PROCESADORES, slug)) return false;
  return hayCuentaConfigurada(slug);
}

export * from "./tipos";
