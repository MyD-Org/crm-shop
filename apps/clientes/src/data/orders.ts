/**
 * Forma de un pedido tal como lo renderiza el shop.
 *
 * Solo tipos y etiquetas: los pedidos reales salen de la DB (src/lib/pedidos.ts)
 * y llegan a los componentes por props. Este módulo lo importan tanto Server
 * Components como client components, así que no puede tocar la DB.
 */

export type OrderEstado =
  | "pendiente"
  | "confirmado"
  | "preparacion"
  | "en_camino"
  | "entregado"
  | "cancelado";

export type PagoEstado = "pendiente" | "pagado" | "fallido";

export interface OrderItem {
  id: string;
  name: string;
  brand: string;
  code: string | null;
  qty: number;
  /** Unitario SIN IVA, congelado al momento de la compra. */
  price: number;
  total: number;
}

export interface Order {
  id: string;
  /** Número visible, ya formateado (PED-00001042). */
  numero: string;
  fecha: string; // ISO
  estado: OrderEstado;
  pagoEstado: PagoEstado;
  metodoPago: string;
  metodoEntrega: string;
  entregaCiudad?: string;
  entregaDireccion?: string;
  subtotal: number;
  iva: number;
  costoEnvio: number;
  total: number;
  items: OrderItem[];
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
