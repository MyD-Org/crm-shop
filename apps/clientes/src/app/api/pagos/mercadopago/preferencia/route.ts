import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { getPedidoParaPago, motivoNoCobrable } from "@/lib/pedidos";
import { procesadorDeMedio } from "@/lib/medios-pago";
import { permitir } from "@/lib/rate-limit";
import { crearPreferencia, mercadoPagoConfigurado } from "@/lib/pagos/mercadopago";
import { armarPreferencia } from "@/lib/pagos/mercadopago-preferencia";

const MAX_PEDIDOS = 20;
const VENTANA_MS = 5 * 60_000;

/**
 * POST /api/pagos/mercadopago/preferencia — crea la preferencia para pagar con la cuenta de Mercado Pago
 * un pedido propio ya creado, y devuelve la URL de Mercado Pago a la que se lleva al comprador.
 *
 * No cobra nada: el comprador paga en el flujo de Mercado Pago, vuelve a `/checkout?pedido=<id>` y el
 * webhook (o la consulta del sondeo) registra el cobro por `registrarCobro`, por `external_reference`.
 * Monto y referencia salen SIEMPRE del pedido persistido, nunca del body.
 */
export async function POST(req: Request) {
  const { clerkUserId, cliente, email } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!mercadoPagoConfigurado()) {
    return NextResponse.json(
      { error: "Los pagos en línea no están disponibles en este momento.", motivo: "mp_no_configurado" },
      { status: 409 },
    );
  }

  if (!permitir(`pago-pref:${clerkUserId ?? cliente?.codigocliente}`, MAX_PEDIDOS, VENTANA_MS)) {
    return NextResponse.json({ error: "Demasiados intentos. Espere unos minutos." }, { status: 429 });
  }

  let pedidoId = "";
  try {
    const body = (await req.json()) as { pedidoId?: unknown };
    pedidoId = typeof body.pedidoId === "string" ? body.pedidoId.trim().slice(0, 60) : "";
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!pedidoId) return NextResponse.json({ error: "Falta el pedido." }, { status: 400 });

  const pedido = await getPedidoParaPago(pedidoId, {
    clerkUserId,
    clienteCodigo: cliente?.codigocliente,
  });
  if (!pedido || procesadorDeMedio(pedido.pagoMetodo) !== "mercadopago") {
    return NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404 });
  }
  if (pedido.pagoEstado === "pagado") {
    return NextResponse.json({ error: "Este pedido ya está pagado.", motivo: "pagado" }, { status: 409 });
  }
  if (motivoNoCobrable(pedido)) {
    return NextResponse.json(
      { error: "Este pedido ya no se puede pagar en línea.", motivo: "pedido_no_cobrable" },
      { status: 409 },
    );
  }
  try {
    const url = await crearPreferencia(
      armarPreferencia({
        pedidoId: pedido.id,
        numero: pedido.numero,
        total: pedido.total,
        origen: new URL(req.url).origin,
        emailComprador: pedido.clienteEmail ?? cliente?.email ?? email ?? undefined,
        cuotas: pedido.cuotas,
      }),
    );
    return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[/api/pagos/mercadopago/preferencia] error:", err);
    return NextResponse.json(
      { error: "No pudimos habilitar el pago con cuenta de Mercado Pago. Puede pagar con tarjeta." },
      { status: 502 },
    );
  }
}
