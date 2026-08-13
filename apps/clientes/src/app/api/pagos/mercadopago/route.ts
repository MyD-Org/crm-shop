import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { getPedidoParaPago, registrarCobro, registrarIntentoFallido } from "@/lib/pedidos";
import { MENSAJE_RECHAZO, convieneReintentar } from "@/lib/pagos";
import { mercadoPago } from "@/lib/pagos/mercadopago";
import { permitir } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Intentos de cobro por usuario. Alto para no molestar a quien reintenta bien. */
const MAX_INTENTOS = 10;
const VENTANA_MS = 5 * 60_000;

interface Body {
  pedidoId?: unknown;
  token?: unknown;
  cuotas?: unknown;
  metodoPagoId?: unknown;
  medio?: unknown;
}

const texto = (v: unknown, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/**
 * POST /api/pagos/mercadopago — cobra un pedido ya creado.
 *
 * El pedido existe ANTES de intentar cobrar: si el cobro falla, queda ahí para
 * reintentar con otro medio sin que el comprador tenga que rehacer el checkout.
 *
 * El monto NO se acepta del cliente. Sale del pedido persistido, que es el
 * total congelado en la transacción que lo creó.
 */
export async function POST(req: Request) {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const clave = `pago:${clerkUserId ?? cliente?.codigocliente}`;
  if (!permitir(clave, MAX_INTENTOS, VENTANA_MS)) {
    return NextResponse.json(
      { error: "Demasiados intentos de pago. Esperá unos minutos." },
      { status: 429 },
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const pedidoId = texto(body.pedidoId, 60);
  if (!pedidoId) {
    return NextResponse.json({ error: "Falta el pedido." }, { status: 400 });
  }

  const medio = body.medio === "cuenta_mp" ? "cuenta_mp" : "tarjeta";
  const token = texto(body.token, 200);
  if (medio === "tarjeta" && !token) {
    return NextResponse.json({ error: "Falta el token de la tarjeta." }, { status: 400 });
  }

  // Ownership: `getPedidoParaPago` filtra por dueño, así que un pedido ajeno
  // devuelve null y sale por el 404 de abajo.
  const pedido = await getPedidoParaPago(pedidoId, {
    clerkUserId,
    clienteCodigo: cliente?.codigocliente,
  });

  if (!pedido) {
    return NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404 });
  }

  // Ya cobrado: no se vuelve a cobrar. Es la última barrera contra el doble
  // cobro, después de la idempotencia del lado de Mercado Pago.
  if (pedido.pagoEstado === "pagado") {
    return NextResponse.json({ estado: "pagado", yaEstaba: true });
  }

  const cuotasCrudas = Number(body.cuotas);
  const cuotas =
    Number.isFinite(cuotasCrudas) && cuotasCrudas >= 1 && cuotasCrudas <= 24
      ? Math.floor(cuotasCrudas)
      : 1;

  try {
    const resultado = await mercadoPago.crearPago({
      pedidoId: pedido.id,
      monto: pedido.total,
      descripcion: `Pedido ${pedido.numero} — Central LED`,
      medio,
      token: token || undefined,
      cuotas,
      metodoPagoId: texto(body.metodoPagoId, 40) || undefined,
      emailComprador: pedido.clienteEmail ?? undefined,
      tipoDocumento: pedido.facturacionTipoDoc ?? undefined,
      numeroDocumento: pedido.facturacionNroDoc ?? undefined,
    });

    await registrarCobro(pedido.id, {
      proveedor: mercadoPago.id,
      referencia: resultado.referencia,
      estado: resultado.estado,
      detalle: resultado.detalle,
      medio,
    });

    /**
     * Se responde el estado traducido, nunca el crudo de Mercado Pago: sus
     * mensajes filtran información de la cuenta y del antifraude.
     *
     * El webhook es igualmente la fuente de verdad — esta respuesta es para que
     * el comprador vea algo ahora, no para decidir si cobramos.
     */
    return NextResponse.json({
      estado: resultado.estado,
      motivo: resultado.motivo,
      mensaje: resultado.motivo ? MENSAJE_RECHAZO[resultado.motivo] : undefined,
      reintentable: resultado.motivo ? convieneReintentar(resultado.motivo) : false,
      desafio: resultado.desafio,
      referencia: resultado.referencia,
    });
  } catch (err) {
    console.error("[/api/pagos/mercadopago] error:", err);
    // Deja rastro del intento fallido. Sin esto el pedido queda en `pendiente`
    // sin ninguna señal de que alguien trató de pagar y no pudo.
    await registrarIntentoFallido(
      pedido.id,
      err instanceof Error ? err.message : String(err),
    ).catch((e) => console.error("[/api/pagos/mercadopago] no se pudo registrar el intento:", e));

    return NextResponse.json(
      { error: "No pudimos procesar el pago. Probá de nuevo en un momento." },
      { status: 502 },
    );
  }
}
