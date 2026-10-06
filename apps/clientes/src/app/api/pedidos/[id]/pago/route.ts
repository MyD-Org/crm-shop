import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { estadoPagoDelPedido } from "@/lib/pagos/estado-pago-pedido";
import { permitir } from "@/lib/rate-limit";

/** Una consulta cada 5 s durante unos minutos más las del detalle: holgado para quien espera bien. */
const MAX_CONSULTAS = 120;
const VENTANA_MS = 5 * 60_000;

/**
 * GET /api/pedidos/:id/pago — estado del pago de un pedido propio.
 *
 * Lo sondea el checkout mientras muestra "Estamos confirmando su pago" y lo dispara el detalle del
 * pedido en Mi cuenta cuando el pago sigue pendiente. Si hay un intento abierto, le pregunta al
 * procesador (sólo consulta) y registra el resultado: ver `estadoPagoDelPedido`. Un pedido ajeno
 * responde 404, igual que uno inexistente.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!permitir(`pago-estado:${clerkUserId ?? cliente?.codigocliente}`, MAX_CONSULTAS, VENTANA_MS)) {
    return NextResponse.json(
      { error: "Demasiadas consultas. Espere unos minutos." },
      { status: 429 },
    );
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "Falta el pedido." }, { status: 400 });

  const estado = await estadoPagoDelPedido(id, {
    clerkUserId,
    clienteCodigo: cliente?.codigocliente,
  });
  if (!estado) return NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404 });

  return NextResponse.json(estado, { headers: { "Cache-Control": "no-store" } });
}
