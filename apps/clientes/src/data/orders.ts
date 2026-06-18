export type OrderEstado = "entregado" | "en_camino" | "preparacion" | "cancelado";

export interface OrderItem {
  id: string;
  name: string;
  brand: string;
  qty: number;
  price: number;
}

export interface Order {
  id: string;
  numero: string;
  fecha: string; // ISO
  estado: OrderEstado;
  metodoPago: string;
  metodoEntrega: string;
  items: OrderItem[];
}

// Pedidos de ejemplo realizados desde la tienda. Reemplazar por datos reales
// cuando exista el backend de pedidos.
export const ORDERS: Order[] = [
  {
    id: "ord-1042",
    numero: "TN-0001042",
    fecha: "2026-06-10T14:30:00",
    estado: "entregado",
    metodoPago: "Transferencia bancaria",
    metodoEntrega: "Envío a domicilio",
    items: [
      { id: "1", name: "Panel LED 48W 60x60 embutir luz fria", brand: "Macroled", qty: 4, price: 14990 },
      { id: "3", name: "Lampara LED A60 12W E27", brand: "Philips", qty: 10, price: 3200 },
    ],
  },
  {
    id: "ord-1039",
    numero: "TN-0001039",
    fecha: "2026-05-28T10:15:00",
    estado: "en_camino",
    metodoPago: "Efectivo en el local",
    metodoEntrega: "Retiro en local",
    items: [
      { id: "2", name: "Cable unipolar 2.5mm x 100m", brand: "Kalop", qty: 2, price: 45000 },
    ],
  },
  {
    id: "ord-1028",
    numero: "TN-0001028",
    fecha: "2026-05-02T11:20:00",
    estado: "entregado",
    metodoPago: "Cuenta corriente",
    metodoEntrega: "Envío a domicilio",
    items: [
      { id: "4", name: "Tablero estanco 12 módulos IP65", brand: "Genrod", qty: 2, price: 12700 },
      { id: "5", name: "Disyuntor diferencial 2x40A 30mA", brand: "Sica", qty: 3, price: 18600 },
      { id: "6", name: "Reflector LED 50W IP66 exterior", brand: "Macroled", qty: 9, price: 7455 },
    ],
  },
];

// Resumen agregado del año (mock). Reemplazar por datos reales del backend.
export const ORDER_SUMMARY = {
  pedidosEsteAnio: 12,
  enCurso: 1,
  compradoEsteAnio: 1284500,
};

export const ORDER_ESTADO_LABEL: Record<OrderEstado, string> = {
  entregado: "Entregado",
  en_camino: "En camino",
  preparacion: "En preparación",
  cancelado: "Cancelado",
};
