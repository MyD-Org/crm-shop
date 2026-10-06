import { cobrarPedido } from "@/lib/pagos/cobrar";
import { mercadoPago } from "@/lib/pagos/mercadopago";

/**
 * POST /api/pagos/mercadopago — cobra un pedido ya creado con Mercado Pago.
 *
 * URL histórica del Brick: se conserva tal cual y delega en la lógica común (`cobrarPedido`), la
 * misma que usa `POST /api/pagos/[proveedor]`.
 */
export function POST(req: Request) {
  return cobrarPedido(mercadoPago, req);
}
