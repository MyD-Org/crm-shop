import { CARRITO_VACIO, type CartItem } from "@/lib/carrito-cliente";

/** Lo que del valor del carrito depende de localStorage (o del servidor de carritos). */
export interface ValorCarritoVisible {
  items: CartItem[];
  cupon: string | null;
  total: number;
  count: number;
  ready: boolean;
}

/**
 * El carrito tal como lo pinta el servidor: vacío, sin cupón y sin `ready`.
 *
 * El `CartProvider` vive en el shell y se hidrata primero; enseguida pasa a los
 * datos reales de localStorage. Un consumidor dentro de un `<Suspense>` del
 * layout o de la página se hidrata DESPUÉS: si leyera el valor ya actualizado,
 * su primer render no coincidiría con el HTML del servidor (React #418) y React
 * descartaría ese HTML para rearmar el bloque en el cliente. Por eso `useCart`
 * entrega esta vista mientras el consumidor se hidrata.
 */
export function vistaDeServidor<T extends ValorCarritoVisible>(valor: T): T {
  return { ...valor, items: CARRITO_VACIO, cupon: null, total: 0, count: 0, ready: false };
}
