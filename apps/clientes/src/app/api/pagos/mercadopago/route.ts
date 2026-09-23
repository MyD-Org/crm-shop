import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import {
  getPedidoParaPago,
  motivoNoCobrable,
  registrarCobro,
  registrarIntentoFallido,
  reservarIntento,
} from "@/lib/pedidos";
import { ErrorProveedor, MENSAJE_RECHAZO, convieneReintentar } from "@/lib/pagos";
import { resolverIntentoAbierto } from "@/lib/pagos/intento-abierto";
import { mercadoPago, urlNotificacion } from "@/lib/pagos/mercadopago";
import { permitir } from "@/lib/rate-limit";
import { cuotasHabilitadas } from "@/lib/cuotas-flag";
import { pagosHabilitados } from "@/lib/pagos-flag";
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

/** Pedido cancelado, tomado por un operador o vencido. Ver `motivoNoCobrable`. */
const NO_COBRABLE = {
  error:
    "Este pedido ya no se puede pagar en línea. Si todavía desea la compra, genere un pedido nuevo desde el carrito.",
  motivo: "pedido_no_cobrable",
};

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

  // Con los pagos apagados no se INICIA ningún cobro, ni siquiera el de un
  // pedido de Mercado Pago creado cuando estaban prendidos. El webhook y la
  // conciliación siguen corriendo: un pago que ya estaba en vuelo se acredita
  // igual. Se corta acá, antes de leer el pedido o de hablar con Mercado Pago.
  if (!pagosHabilitados()) {
    return NextResponse.json(
      {
        error:
          "Los pagos en línea no están disponibles en este momento. Un asesor coordinará el pago con usted.",
        motivo: "pagos_deshabilitados",
      },
      { status: 409 },
    );
  }

  const clave = `pago:${clerkUserId ?? cliente?.codigocliente}`;
  if (!permitir(clave, MAX_INTENTOS, VENTANA_MS)) {
    return NextResponse.json(
      { error: "Demasiados intentos de pago. Espere unos minutos." },
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

  // Sólo se cobra un pedido que el comprador confirmó PARA pagar por Mercado
  // Pago. Sin esto, cualquier pedido propio era cobrable con sólo conocer su id:
  // uno "a coordinar" (o por transferencia) terminaba con un cobro que nadie
  // pidió. Mismo 404 que un pedido ajeno, y antes de cualquier llamada a Mercado
  // Pago o de escribir un intento fallido: sus columnas de pago no se tocan.
  if (pedido.pagoMetodo !== "mercadopago") {
    return NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404 });
  }

  // Ya cobrado: no se vuelve a cobrar. Es la última barrera contra el doble
  // cobro, después de la idempotencia del lado de Mercado Pago.
  if (pedido.pagoEstado === "pagado") {
    return NextResponse.json({ estado: "pagado", yaEstaba: true });
  }

  // Un pedido cancelado, ya tomado por un operador o demasiado viejo no se
  // cobra: el total congelado puede no valer más, o el pedido ya no existe
  // para nadie. Mismo corte temprano: sin tocar Mercado Pago.
  if (motivoNoCobrable(pedido)) {
    return NextResponse.json(NO_COBRABLE, { status: 409 });
  }

  const metodoPagoId = texto(body.metodoPagoId, 40) || undefined;

  /**
   * Cuotas contra el máximo congelado en el pedido (por proveedor, igual para
   * todas las tarjetas). Un rechazo corta ACÁ, sin llamar a Mercado Pago: el
   * browser no decide cuántas cuotas se pueden. Flag apagado o pedido legacy
   * (cuotas_max null) → clamp 1..24 de siempre. `metodoPagoId` sólo viaja a
   * Mercado Pago, no participa de la validación.
   */
  const validacion = validarCuotasPago({
    cuotas: body.cuotas,
    medio,
    cuotasMax: pedido.cuotasMax,
    habilitado: cuotasHabilitadas(),
  });
  if (!validacion.ok) {
    return NextResponse.json(
      { error: MENSAJE_RECHAZO.cuotas_no_disponibles, motivo: "cuotas_no_disponibles" },
      { status: 422 },
    );
  }
  const cuotas = validacion.cuotas;

  /**
   * Un intento a la vez. Si hay otro abierto se intenta cerrarlo (cancelándolo
   * en Mercado Pago); si no se puede, el comprador espera. Dos pagos abiertos
   * pueden aprobarse los dos.
   */
  let reserva = await reservarIntento(pedido.id, mercadoPago.id, medio);
  if (reserva && "abierto" in reserva) {
    const resolucion = await resolverIntentoAbierto(pedido.id, reserva.abierto, mercadoPago);
    if (resolucion === "pagado") {
      return NextResponse.json({ estado: "pagado", yaEstaba: true });
    }
    reserva = resolucion === "libre" ? await reservarIntento(pedido.id, mercadoPago.id, medio) : reserva;
  }
  if (!reserva) {
    return NextResponse.json({ error: "No encontramos ese pedido." }, { status: 404 });
  }
  if ("noCobrable" in reserva) {
    return NextResponse.json(NO_COBRABLE, { status: 409 });
  }
  if ("abierto" in reserva) {
    return NextResponse.json(
      {
        error:
          "Ya hay un pago en proceso para este pedido. Espere unos minutos a que se confirme antes de intentarlo de nuevo.",
        motivo: "pago_en_curso",
      },
      { status: 409 },
    );
  }
  const { intentoId } = reserva;

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
      // La cuenta de Mercado Pago es argentina y solo conoce documentos
      // argentinos: con un CPF o un RUC en `identification.type` rechaza el
      // pago. El documento es opcional, así que a un extranjero se le cobra sin
      // él; el dato fiscal ya quedó en el pedido.
      ...(pedido.facturacionTipoDoc === "CUIT" || pedido.facturacionTipoDoc === "DNI"
        ? {
            tipoDocumento: pedido.facturacionTipoDoc,
            numeroDocumento: pedido.facturacionNroDoc ?? undefined,
          }
        : {}),
    });

    await registrarCobro(
      pedido.id,
      {
        proveedor: mercadoPago.id,
        referencia: resultado.referencia,
        estado: resultado.estado,
        detalle: resultado.detalle,
        medio,
        cuotas: resultado.cuotasPagadas,
        totalPagado: resultado.totalPagado,
      },
      { intentoId },
    );

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
    //
    // La reserva se cierra sólo si Mercado Pago RESPONDIÓ con un rechazo del
    // request (4xx): ahí es seguro que no hay pago. Con un timeout o un 5xx el
    // pago pudo haberse creado igual; la reserva queda abierta para que la
    // reclame el webhook, y si no llega nada se da por abandonada a los pocos
    // minutos (`RESERVA_ABANDONADA_MS`).
    const sinPago = err instanceof ErrorProveedor && err.status < 500;
    await registrarIntentoFallido(
      pedido.id,
      err instanceof Error ? err.message : String(err),
      sinPago ? intentoId : undefined,
    ).catch((e) => console.error("[/api/pagos/mercadopago] no se pudo registrar el intento:", e));

    return NextResponse.json(
      { error: "No pudimos procesar el pago. Inténtelo de nuevo en un momento." },
      { status: 502 },
    );
  }
}
