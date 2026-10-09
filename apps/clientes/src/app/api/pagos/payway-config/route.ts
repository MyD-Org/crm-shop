import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { procesadorDeMedio } from "@/lib/medios-pago";
import { getPedidoParaPago } from "@/lib/pedidos";
import { cuentaParaCobrar } from "@/lib/pagos/cuentas-sucursales";
import { paywayConfigPublica } from "@/lib/pagos/payway";

const SIN_CACHE = { "Cache-Control": "no-store" };

/**
 * GET /api/pagos/payway-config?pedido=<id> — lo que el formulario de tarjeta necesita para tokenizar en
 * el navegador con la cuenta de Payway que cobra ESE pedido (la de su sucursal): la cuenta, su API key
 * PÚBLICA (sirve sólo para crear tokens) y la base de la API.
 *
 * Sale del servidor en cada request en vez de una variable `NEXT_PUBLIC_*`: no exige otra variable ni
 * un rebuild al rotarla. Pide sesión y que el pedido sea de quien consulta (un pedido ajeno es 404, sin
 * revelar nada). Nunca devuelve la key privada.
 */
export async function GET(req: Request) {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401, headers: SIN_CACHE });
  }
  const id = new URL(req.url).searchParams.get("pedido")?.trim().slice(0, 60) ?? "";
  const noEncontrado = () =>
    NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404, headers: SIN_CACHE });
  if (!id) return noEncontrado();

  const pedido = await getPedidoParaPago(id, { clerkUserId, clienteCodigo: cliente?.codigocliente });
  if (!pedido || procesadorDeMedio(pedido.pagoMetodo) !== "payway") return noEncontrado();

  const elegida = await cuentaParaCobrar("payway", pedido);
  const config = elegida.ok ? paywayConfigPublica(elegida.cuenta) : null;
  if (!config) {
    return NextResponse.json(
      { error: "Los pagos en línea no están disponibles en este momento. Un asesor coordinará el pago con usted." },
      { status: 409, headers: SIN_CACHE },
    );
  }
  return NextResponse.json(config, { headers: SIN_CACHE });
}
