import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { cancelarPedidoPendiente } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

/**
 * POST /api/pedidos/:id/cancelar — cancela un pedido pendiente propio.
 *
 * Se llama desde el checkout cuando el comprador quiere abandonar el pedido
 * que dejó a medias y armar uno nuevo. El backend filtra por dueño y por
 * estado `pendiente`: sin esos filtros alguien podría adivinar ids ajenos, y
 * un pedido ya pagado no se cancela por acá — para eso está la devolución.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Falta el pedido" }, { status: 400 });
  }

  const cancelado = await cancelarPedidoPendiente(id, {
    clerkUserId,
    clienteCodigo: cliente?.codigocliente,
  });

  if (!cancelado) {
    // Puede ser que no exista, no sea del user, o ya se haya pagado. No
    // desglosamos motivos: filtrar por el motivo real le da al atacante una
    // señal para adivinar ids.
    return NextResponse.json(
      { error: "No se pudo cancelar el pedido" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
