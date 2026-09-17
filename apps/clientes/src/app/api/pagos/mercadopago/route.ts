import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { getPedidoParaPago, registrarCobro, registrarIntentoFallido } from "@/lib/pedidos";
import { MENSAJE_RECHAZO, convieneReintentar } from "@/lib/pagos";
import { mercadoPago, urlNotificacion } from "@/lib/pagos/mercadopago";
import { permitir } from "@/lib/rate-limit";
import { cuotasHabilitadas } from "@/lib/cuotas-flag";
import { validarCuotasPago } from "@/lib/pagos/cuotas-validacion";

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
  const { clerkUserId, cliente, email } = await identidadActual();
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

  const metodoPagoId = texto(body.metodoPagoId, 40) || undefined;

  /**
   * Cuotas contra el plan congelado en el pedido (global y por medio). Un
   * rechazo corta ACÁ, sin llamar a Mercado Pago: el browser no decide cuántas
   * cuotas se pueden. Flag apagado o pedido legacy (cuotas_max null) → clamp
   * 1..24 de siempre.
   */
  const validacion = validarCuotasPago({
    cuotas: body.cuotas,
    metodoPagoId,
    medio,
    cuotasMax: pedido.cuotasMax,
    maxPorMedio: pedido.cuotasMaxPorMedio,
    habilitado: cuotasHabilitadas(),
  });
  if (!validacion.ok) {
    return NextResponse.json(
      { error: MENSAJE_RECHAZO.cuotas_no_disponibles, motivo: "cuotas_no_disponibles" },
      { status: 422 },
    );
  }
  const cuotas = validacion.cuotas;

  try {
    const resultado = await mercadoPago.crearPago({
      pedidoId: pedido.id,
      monto: pedido.total,
      descripcion: `Pedido ${pedido.numero} — Central LED`,
      // El dominio por el que entró el comprador: www en producción, dev en
      // staging. Así el webhook vuelve al mismo entorno que creó el pago.
      urlNotificacion: urlNotificacion(new URL(req.url).origin),
      medio,
      token: token || undefined,
      cuotas,
      metodoPagoId,
      /**
       * Mercado Pago EXIGE `payer.email`: sin él responde 400 "Params Error",
       * sin decir cuál parámetro falta.
       *
       * El fallback a la sesión no es decorativo: los pedidos creados antes de
       * este arreglo tienen `cliente_email` en null, y sin esto seguirían sin
       * poder cobrarse aunque el comprador vuelva a intentar.
       */
      emailComprador: pedido.clienteEmail ?? cliente?.email ?? email ?? undefined,
      tipoDocumento: pedido.facturacionTipoDoc ?? undefined,
      numeroDocumento: pedido.facturacionNroDoc ?? undefined,
    });

    await registrarCobro(pedido.id, {
      proveedor: mercadoPago.id,
      referencia: resultado.referencia,
      estado: resultado.estado,
      detalle: resultado.detalle,
      medio,
      cuotas: resultado.cuotasPagadas,
      totalPagado: resultado.totalPagado,
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
