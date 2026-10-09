import { NextResponse, after } from "next/server";
import { identidadActual } from "@/lib/auth";
import { avisarPedidoSiFalta } from "@/lib/pedido-avisos";
import { esPedidoPropio } from "@/lib/pedidos";
import { permitirAsync } from "@/lib/rate-limit";

const MAX_LLAMADAS = 30;
const VENTANA_MS = 5 * 60_000;

/**
 * POST /api/pedidos/:id/avisos — el comprador se fue de la pantalla de transferencia: salen los avisos
 * del pedido ("Recibimos su pedido" y "Nuevo pedido") con el medio que tenga ahora, si todavía no
 * salieron. Lo manda el navegador con `navigator.sendBeacon` (no espera respuesta). Repetirlo no
 * duplica nada (`avisarPedidoSiFalta`), y un pedido con cobro en línea no avisa por acá. Si el
 * navegador no llega a mandarlo, el cron lo cubre a los 15 minutos.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!await permitirAsync(`pedido-avisos:${clerkUserId ?? cliente?.codigocliente}`, MAX_LLAMADAS, VENTANA_MS)) {
    return NextResponse.json({ error: "Demasiados intentos. Espere unos minutos." }, { status: 429 });
  }
  const { id } = await ctx.params;
  if (!id || !(await esPedidoPropio(id, { clerkUserId, clienteCodigo: cliente?.codigocliente }))) {
    return NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404 });
  }
  after(() => avisarPedidoSiFalta(id).then(() => undefined));
  return new NextResponse(null, { status: 204 });
}
