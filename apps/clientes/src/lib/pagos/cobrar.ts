import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import {
  cerrarIntentoSinPago,
  fijarReferenciaIntento,
  getItemsParaAntifraude,
  getPedidoParaPago,
  motivoNoCobrable,
  registrarCobro,
  registrarIntentoFallido,
  reservarIntento,
} from "@/lib/pedidos";
import {
  ErrorProveedor,
  MENSAJE_RECHAZO,
  convieneReintentar,
  type DatosAntifraude,
  type ProveedorPago,
} from "@/lib/pagos/tipos";
import { resolverIntentoAbierto } from "@/lib/pagos/intento-abierto";
import { procesadorDeMedio } from "@/lib/medios-pago";
import { permitir } from "@/lib/rate-limit";
import { validarCuotasPago } from "@/lib/pagos/cuotas-validacion";

/** Intentos de cobro por usuario. Alto para no molestar a quien reintenta bien. */
const MAX_INTENTOS = 10;
const VENTANA_MS = 5 * 60_000;

interface Body {
  pedidoId?: unknown;
  token?: unknown;
  cuotas?: unknown;
  metodoPagoId?: unknown;
  medio?: unknown;
  bin?: unknown;
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
 * Cobra un pedido ya creado con el procesador `proveedor`. Lo comparten las rutas
 * `POST /api/pagos/mercadopago` (URL histórica) y `POST /api/pagos/[proveedor]`.
 *
 * El pedido existe ANTES de intentar cobrar: si el cobro falla, queda ahí para
 * reintentar con otro medio sin que el comprador tenga que rehacer el checkout.
 *
 * El monto NO se acepta del cliente. Sale del pedido persistido, que es el
 * total congelado en la transacción que lo creó.
 */
export async function cobrarPedido(proveedor: ProveedorPago, req: Request): Promise<Response> {
  const { clerkUserId, cliente, email, registradoEn } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Sin credenciales del procesador en el Shop no se puede cobrar nada. Se corta acá, antes de
  // leer el pedido o de hablar con el procesador. NO se exige que el medio esté activo en el CRM:
  // sólo se cobran pedidos que ya son de este procesador (más abajo), así un pedido en vuelo se paga
  // aunque el operador desactive el medio; crear pedidos nuevos ya lo bloquea POST /api/pedidos.
  // El webhook y la conciliación no pasan por acá y siguen corriendo siempre.
  if (!proveedor.configurado()) {
    return NextResponse.json(
      {
        error:
          "Los pagos en línea no están disponibles en este momento. Un asesor coordinará el pago con usted.",
        // `mp_no_configurado` es el motivo histórico de Mercado Pago; ningún cliente lo lee.
        motivo: proveedor.id === "mercadopago" ? "mp_no_configurado" : "procesador_no_configurado",
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

  // El BIN lo informa la tokenización del navegador. Se valida antes de reservar nada: sin él un
  // procesador que lo exige rechazaría el request.
  const bin = typeof body.bin === "string" && /^\d{6}$/.test(body.bin) ? body.bin : undefined;
  if (proveedor.requiereBin && !bin) {
    return NextResponse.json(
      { error: "Faltan datos de la tarjeta. Vuelva a ingresarla.", motivo: "datos_invalidos" },
      { status: 400 },
    );
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

  // Sólo se cobra un pedido que el comprador confirmó PARA pagar por este
  // procesador (el medio del pedido decide cuál: `procesadorDeMedio`). Sin esto, cualquier pedido propio era cobrable con sólo conocer su id:
  // uno "a coordinar" (o por transferencia) terminaba con un cobro que nadie
  // pidió. Mismo 404 que un pedido ajeno, y antes de cualquier llamada a Mercado
  // Pago o de escribir un intento fallido: sus columnas de pago no se tocan.
  if (procesadorDeMedio(pedido.pagoMetodo) !== proveedor.id) {
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
   * Cuotas contra lo congelado en el pedido: IGUALDAD estricta (cada cantidad es una lista de precios
   * distinta, así que no se puede cobrar otra). Un rechazo corta ACÁ, sin llamar al procesador: el
   * navegador no decide cuántas cuotas se cobran. El monto cobrado es siempre `pedido.total` (leído de
   * la base, nunca del body). Pedido sin cuotas congeladas (flag apagado o anterior) → clamp 1..24 de
   * siempre. `metodoPagoId` sólo viaja al procesador, no participa de la validación.
   */
  const validacion = validarCuotasPago({
    cuotas: body.cuotas,
    medio,
    cuotasPedido: pedido.cuotas,
  });
  if (!validacion.ok) {
    return NextResponse.json(
      { error: MENSAJE_RECHAZO[validacion.motivo], motivo: validacion.motivo },
      { status: 422 },
    );
  }
  const cuotas = validacion.cuotas;

  /**
   * Datos para el control de fraude del procesador (sólo si lo pide). Salen del pedido congelado y de la
   * sesión del servidor, nunca del body. Se leen ANTES de reservar el intento: si fallan no queda una
   * reserva abierta. Un dato que no se puede leer corta sin cobrar.
   */
  let antifraude: DatosAntifraude | undefined;
  if (proveedor.requiereAntifraude) {
    try {
      const items = await getItemsParaAntifraude(pedido.id);
      const emailComprador = pedido.clienteEmail ?? cliente?.email ?? email;
      const identificador = clerkUserId ?? cliente?.codigocliente;
      if (!emailComprador || !identificador || items.length === 0) {
        // Sin esto el procesador rechazaría el request (o el control de fraude lo frenaría).
        console.error(`[/api/pagos/${proveedor.id}] faltan datos del comprador o del pedido para el control de fraude.`);
        return NextResponse.json(
          {
            error:
              "No pudimos procesar el pago con los datos de su cuenta. Revise su correo electrónico en Mi cuenta o elija otro medio de pago.",
            motivo: "datos_comprador",
          },
          { status: 422 },
        );
      }
      antifraude = {
        clienteId: identificador,
        email: emailComprador,
        nombre: pedido.contactoNombre ?? "",
        telefono: pedido.contactoTelefono ?? "",
        diasEnSitio:
          typeof registradoEn === "number" && registradoEn > 0
            ? Math.max(0, Math.floor((Date.now() - registradoEn) / 86_400_000))
            : undefined,
        facturacionDomicilio: pedido.facturacionDomicilio,
        entrega: {
          tipo: pedido.entregaTipo === "envio" ? "envio" : "retiro",
          ciudad: pedido.entregaCiudad,
          direccion: pedido.entregaDireccion,
        },
        items,
      };
    } catch (err) {
      console.error(`[/api/pagos/${proveedor.id}] no se pudieron leer los datos del pedido:`, err);
      return NextResponse.json(
        { error: "No pudimos procesar el pago. Inténtelo de nuevo en un momento." },
        { status: 502 },
      );
    }
  }

  /**
   * Un intento a la vez. Si hay otro abierto se intenta cerrarlo (cancelándolo
   * en Mercado Pago); si no se puede, el comprador espera. Dos pagos abiertos
   * pueden aprobarse los dos.
   */
  let reserva = await reservarIntento(pedido.id, proveedor.id, medio);
  if (reserva && "abierto" in reserva) {
    const resolucion = await resolverIntentoAbierto(pedido.id, reserva.abierto, proveedor);
    if (resolucion === "pagado") {
      return NextResponse.json({ estado: "pagado", yaEstaba: true });
    }
    reserva = resolucion === "libre" ? await reservarIntento(pedido.id, proveedor.id, medio) : reserva;
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

  /**
   * Un procesador que conoce la referencia del pago de antemano la deja anotada en el intento ANTES
   * de cobrar. Si el cobro da timeout, el pago pudo crearse igual: con la referencia en el intento,
   * la consulta y la conciliación lo encuentran, y `resolverIntentoAbierto` no lo da por abandonado
   * (una reserva sin referencia se descarta a los 2 minutos y habilitaría un segundo cobro).
   * Si no se puede anotar, NO se cobra.
   */
  const referenciaPrevia = proveedor.referenciaDeIntento?.(intentoId);
  if (referenciaPrevia) {
    try {
      await fijarReferenciaIntento(intentoId, referenciaPrevia);
    } catch (err) {
      console.error(`[/api/pagos/${proveedor.id}] no se pudo anotar la referencia del intento:`, err);
      await registrarIntentoFallido(
        pedido.id,
        err instanceof Error ? err.message : String(err),
        intentoId,
      ).catch((e) => console.error(`[/api/pagos/${proveedor.id}] no se pudo registrar el intento:`, e));
      return NextResponse.json(
        { error: "No pudimos procesar el pago. Inténtelo de nuevo en un momento." },
        { status: 502 },
      );
    }
  }

  try {
    const resultado = await proveedor.crearPago({
      pedidoId: pedido.id,
      monto: pedido.total,
      descripcion: `Pedido ${pedido.numero} — Central LED`,
      // El dominio por el que entró el comprador: www en producción, dev en
      // staging. Así el webhook vuelve al mismo entorno que creó el pago.
      urlNotificacion: proveedor.urlNotificacion?.(new URL(req.url).origin),
      medio,
      token: token || undefined,
      cuotas,
      metodoPagoId,
      // Sólo a quien los usa: el resto del contrato (y el cuerpo que arma Mercado Pago) no cambia.
      ...(referenciaPrevia ? { intentoId } : {}),
      ...(proveedor.requiereBin ? { bin } : {}),
      ...(antifraude ? { antifraude } : {}),
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

    /**
     * Aparte del `try` del cobro: si el procesador ya respondió y lo que falla es guardar el resultado
     * (la base), el cobro existe igual. Antes caía al `catch` de abajo y el comprador veía "No pudimos
     * procesar el pago" con el formulario vacío, aunque se le había cobrado. Ahora se le responde lo que
     * dijo el procesador. Lo registra después el webhook (Mercado Pago, por `external_reference`) o la
     * conciliación (Payway: el intento ya tiene su referencia anotada antes de cobrar).
     */
    try {
      await registrarCobro(
        pedido.id,
        {
          proveedor: proveedor.id,
          referencia: resultado.referencia,
          estado: resultado.estado,
          detalle: resultado.detalle,
          medio,
          cuotas: resultado.cuotasPagadas,
          totalPagado: resultado.totalPagado,
          ...(resultado.info ? { info: resultado.info } : {}),
        },
        { intentoId },
      );
    } catch (err) {
      console.error(
        `[/api/pagos/${proveedor.id}] pedido=${pedido.id}: el procesador respondió ${resultado.estado} pero no se pudo registrar; lo retoma la conciliación`,
        err,
      );
    }

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
    console.error(`[/api/pagos/${proveedor.id}] error:`, err);
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
      sinPago && !referenciaPrevia ? intentoId : undefined,
    ).catch((e) => console.error(`[/api/pagos/${proveedor.id}] no se pudo registrar el intento:`, e));
    // Con referencia ya anotada `descartarReserva` no cierra nada: se cierra aparte, y sólo cuando es
    // seguro que no hay pago (4xx).
    if (sinPago && referenciaPrevia) {
      await cerrarIntentoSinPago(
        intentoId,
        `error_proveedor: ${err instanceof Error ? err.message : String(err)}`,
      ).catch((e) => console.error(`[/api/pagos/${proveedor.id}] no se pudo cerrar el intento:`, e));
    }

    return NextResponse.json(
      { error: "No pudimos procesar el pago. Inténtelo de nuevo en un momento." },
      { status: 502 },
    );
  }
}
