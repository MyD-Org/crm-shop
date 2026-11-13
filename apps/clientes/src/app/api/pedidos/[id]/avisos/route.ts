import { NextResponse, after } from "next/server";
import { resolverPrincipal } from "@/lib/invitado-respuesta";
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
 *
 * El invitado lo manda con `fetch(..., { keepalive: true })` y su token en `X-Pedido-Token`:
 * `sendBeacon` no puede llevar headers, así que para él no sirve.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await resolverPrincipal(req, id || null);
  if ("respuesta" in r) return r.respuesta;
  const { principal } = r;
  if (!await permitirAsync(`pedido-avisos:${principal.clave}`, MAX_LLAMADAS, VENTANA_MS)) {
    return NextResponse.json({ error: "Demasiados intentos. Espere unos minutos." }, { status: 429 });
  }
  if (!id || !(await esPedidoPropio(id, principal.dueno))) {
    return NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404 });
  }
  after(() => avisarPedidoSiFalta(id).then(() => undefined));
  return new NextResponse(null, { status: 204 });
}
