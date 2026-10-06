import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { mercadoPagoConfigurado } from "@/lib/pagos/mercadopago";
import { pedidoPendienteMasReciente } from "@/lib/pedidos";

/**
 * GET /api/pedidos/pendiente — pedido pendiente de pago más reciente del user.
 *
 * Lo usa el checkout al montar para saltar al brick con un pedido ya creado en
 * vez de crear otro nuevo. Ver `pedidoPendienteMasReciente` en pedidos.ts.
 *
 * Devuelve `{ pedido: null }` cuando no hay: distinto de un 404 para que el
 * cliente no confunda "no hay pendiente" con "el endpoint no existe".
 */
export async function GET() {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Sin credenciales de Mercado Pago no hay rescate: este endpoint existe para retomar el cobro de
  // un pedido de Mercado Pago y sin credenciales no se puede cobrar. Se corta antes de consultar la
  // base. Con el medio desactivado en el CRM SÍ se rescata: el pedido ya existe y es de `mercadopago`.
  if (!mercadoPagoConfigurado()) {
    return NextResponse.json({ pedido: null });
  }

  const pedido = await pedidoPendienteMasReciente({
    clerkUserId,
    clienteCodigo: cliente?.codigocliente,
  });

  // `cuotas` es lo congelado al crear el pedido (null = sin cuotas elegidas): el formulario de pago se
  // limita a esa cantidad, igual con el flag apagado después.
  return NextResponse.json({ pedido: pedido ?? null });
}
