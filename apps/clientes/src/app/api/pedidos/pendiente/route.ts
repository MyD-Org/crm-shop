import { NextResponse } from "next/server";
import { procesadorConfigurado } from "@/lib/pagos";
import { procesadorDeMedio, slugsPagoEnLinea } from "@/lib/medios-pago";
import { identidadActual } from "@/lib/auth";
import { pedidoParaReintentarPago, pedidoPendienteMasReciente } from "@/lib/pedidos";

/**
 * GET /api/pedidos/pendiente — pedido pendiente de pago más reciente del user.
 *
 * Lo usa el checkout al montar para saltar al brick con un pedido ya creado en
 * vez de crear otro nuevo. Ver `pedidoPendienteMasReciente` en pedidos.ts.
 *
 * Devuelve `{ pedido: null }` cuando no hay: distinto de un 404 para que el
 * cliente no confunda "no hay pendiente" con "el endpoint no existe".
 */
export async function GET(request?: Request) {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // `?pedido=<id>`: reintento del cobro de ESE pedido (link "Reintentar el pago"), también con el
  // pago rechazado. Nunca crea un pedido: devuelve el mismo, con su total y cuotas congelados.
  const idReintento = request ? new URL(request.url).searchParams.get("pedido") : null;
  if (idReintento) {
    const r = await pedidoParaReintentarPago({ clerkUserId, clienteCodigo: cliente?.codigocliente }, idReintento);
    if (r.ok) return NextResponse.json({ pedido: r.pedido });
    if (r.motivo === "no_existe") {
      return NextResponse.json({ error: "No encontramos el pedido." }, { status: 404 });
    }
    return NextResponse.json(
      {
        error:
          r.motivo === "pagado"
            ? "Este pedido ya está pagado."
            : "Este pedido ya no se puede pagar. Puede volver a comprar los mismos productos.",
        motivo: r.motivo,
        // Pagado: el checkout muestra "¡Pago acreditado!" en vez de un error (vuelta de Mercado Pago).
        ...(r.motivo === "pagado" ? { pedido: r.pedido } : {}),
      },
      { status: 409 },
    );
  }

  // Sin credenciales del procesador no hay rescate: este endpoint existe para retomar el cobro de un
  // pedido con pago en línea y sin credenciales no se puede cobrar. Sólo se buscan pedidos de medios
  // cuyo procesador está configurado, y si no hay ninguno se corta antes de consultar la base. Con el
  // medio desactivado en el CRM SÍ se rescata: el pedido ya existe y se cobra por su procesador.
  const slugs = slugsPagoEnLinea().filter((s) => procesadorConfigurado(procesadorDeMedio(s)));
  if (slugs.length === 0) {
    return NextResponse.json({ pedido: null });
  }

  const pedido = await pedidoPendienteMasReciente(
    { clerkUserId, clienteCodigo: cliente?.codigocliente },
    slugs,
  );

  // `cuotas` es lo congelado al crear el pedido (null = sin cuotas elegidas): el formulario de pago se
  // limita a esa cantidad, igual con el flag apagado después.
  return NextResponse.json({ pedido: pedido ?? null });
}
