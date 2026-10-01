/**
 * Forma de un pedido tal como lo renderiza el shop.
 *
 * Solo tipos y etiquetas: los pedidos reales salen de la DB (src/lib/pedidos.ts)
 * y llegan a los componentes por props. Este módulo lo importan tanto Server
 * Components como client components, así que no puede tocar la DB.
 */

import type { ProductImage } from "./products";
import type { CuentaPagoSnapshot } from "../lib/cuentas-bancarias";

export type OrderEstado =
  | "pendiente"
  | "confirmado"
  | "preparacion"
  | "en_camino"
  | "entregado"
  | "cancelado";

export type PagoEstado = "pendiente" | "pagado" | "fallido";

/**
 * Cómo se entrega el pedido (`orders.entrega_tipo`). Mismo union que
 * `EntregaTipo` de `src/lib/envio.ts`, declarado aparte para que el tipo de UI
 * no dependa de las reglas de envío.
 */
export type EntregaTipoPedido = "retiro" | "envio";

export interface OrderItem {
  /** Id del ítem en Alegra (`order_items.alegra_item_id`): clave del espejo y de /producto/[id]. */
  id: string;
  /** Snapshot de la línea. En esta cuenta de Alegra suele ser el código. */
  name: string;
  brand: string;
  /** Snapshot de `reference`; casi siempre null. */
  code: string | null;
  qty: number;
  /** Unitario SIN IVA, congelado al momento de la compra. */
  price: number;
  total: number;
  /** Nombre real desde el espejo del catálogo, o `name` si el ítem ya no está. */
  nombreVisible: string;
  /**
   * Código para mostrar ("Cód. X"): `code` de la línea, si no el sku del
   * espejo, si no `name`. Si coincide con `nombreVisible`, la UI no lo repite.
   */
  codigo: string;
  /** Portada del overlay, si hay y su host está permitido. */
  imagen?: ProductImage;
}

export interface Order {
  id: string;
  /** Número visible, ya formateado (PED-00001042). */
  numero: string;
  fecha: string; // ISO
  estado: OrderEstado;
  pagoEstado: PagoEstado;
  metodoPago: string;
  /**
   * Lo que guarda `orders.pago_metodo`: método fijo o el slug de
   * un medio de pago del CRM. Mi cuenta lo resuelve a su nombre (`nombreDelPago`).
   */
  pagoMetodoSlug?: string;
  /** Slug de la sucursal asignada (`orders.sucursal`); undefined = sin sucursal. */
  sucursal?: string;
  /**
   * Cuenta bancaria congelada al pedir por transferencia (`orders.pago_cuenta`). undefined = sin
   * cuenta aplicable, otro medio de pago o pedido anterior: se muestra el mensaje neutro.
   */
  cuentaPago?: CuentaPagoSnapshot;
  /** Etiqueta para mostrar ("Envío a domicilio", …). */
  metodoEntrega: string;
  /** Tipo crudo: decide los pasos del seguimiento y el texto de "entregado". */
  entregaTipo: EntregaTipoPedido;
  entregaCiudad?: string;
  entregaDireccion?: string;
  subtotal: number;
  iva: number;
  costoEnvio: number;
  total: number;
  items: OrderItem[];
  /**
   * Id en Alegra de la factura que un operador del CRM vinculó al pedido
   * (`orders.factura_alegra_id`, migración 0013). undefined = sin factura
   * vinculada todavía.
   */
  facturaId?: string;
  /** Número legible de esa factura ("FV-1-00012876"), para mostrar junto al botón. */
  facturaNumero?: string;
}

export interface OrderSummary {
  pedidosEsteAnio: number;
  enCurso: number;
  compradoEsteAnio: number;
}

export const ORDER_ESTADO_LABEL: Record<OrderEstado, string> = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  preparacion: "En preparación",
  en_camino: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

/** Estados que cuentan como "pedido en curso" en el resumen de Mi cuenta. */
export const ESTADOS_EN_CURSO: OrderEstado[] = [
  "pendiente",
  "confirmado",
  "preparacion",
  "en_camino",
];

export const PAGO_ESTADO_LABEL: Record<PagoEstado, string> = {
  pendiente: "Pago pendiente",
  pagado: "Pagado",
  fallido: "Pago rechazado",
};
