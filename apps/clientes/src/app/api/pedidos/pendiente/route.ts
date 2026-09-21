import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { cuotasHabilitadas } from "@/lib/cuotas-flag";
import { pedidoPendienteMasReciente } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

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

  const pedido = await pedidoPendienteMasReciente({
    clerkUserId,
    clienteCodigo: cliente?.codigocliente,
  });

  // `cuotasMax` sólo con el flag prendido: con el flag apagado el Brick no
  // recibe máximo y el cobro vuelve al clamp 1..24.
  return NextResponse.json({
    pedido: pedido
      ? { ...pedido, cuotasMax: cuotasHabilitadas() ? pedido.cuotasMax : null }
      : null,
  });
}
