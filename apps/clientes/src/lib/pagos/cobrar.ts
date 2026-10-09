import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import {
  cerrarIntentoSinPago,
  detalleCredencialesRechazadas,
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
  esCredencialRechazada,
  type DatosAntifraude,
} from "@/lib/pagos/tipos";
import { proveedorPago, rasgosProcesador } from "@/lib/pagos";
import { credencialesMercadoPago, hayCuentaConfigurada } from "@/lib/pagos/credenciales";
import {
  candidatasDelPedido,
  cuentaParaCobrar,
  proveedorDeIntento,
  type PedidoParaCuenta,
} from "@/lib/pagos/cuentas-sucursales";
import { paywayConfigPublica } from "@/lib/pagos/payway";
import { resolverIntentoAbierto } from "@/lib/pagos/intento-abierto";
import { procesadorDeMedio } from "@/lib/medios-pago";
import { permitir } from "@/lib/rate-limit";
import { requierePlanesMP, validarCuotasPago, type EntradaValidacionCuotas } from "@/lib/pagos/cuotas-validacion";
import { opcionDelCobro } from "@/lib/pagos/opciones-cobro";
import { rechazoPorOpcionDeCobro } from "@/lib/pagos/opcion-cobro-guard";
import { consultarPlanesMP } from "@/lib/pagos/mercadopago-planes";
import { marcaDeMercadoPago, marcaDePayway } from "@/lib/pagos/marcas";
import { leerMediosPagoTolerante } from "@/lib/medios-pago-repo";

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
  /** Cuenta con la que el navegador tokenizó la tarjeta (la que le dio el servidor). Se valida acá. */
  cuenta?: unknown;
}

/** Pedido cancelado, tomado por un operador o vencido. Ver `motivoNoCobrable`. */
const NO_COBRABLE = {
  error:
    "Este pedido ya no se puede pagar en línea. Si todavía desea la compra, genere un pedido nuevo desde el carrito.",
  motivo: "pedido_no_cobrable",
};

const texto = (v: unknown, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Lo que el navegador necesita para (re)armar el formulario de la cuenta vigente. */
export type ConfigPublicaCobro = { cuenta: string; publicKey: string; baseUrl?: string };

export function configPublicaCobro(procesadorId: string, cuenta: string): ConfigPublicaCobro | null {
  if (procesadorId === "mercadopago") {
    const { publicKey } = credencialesMercadoPago(cuenta);
    return publicKey ? { cuenta, publicKey } : null;
  }
  if (procesadorId === "payway") return paywayConfigPublica(cuenta);
  return null;
}

/** Al comprador, cuando hay que volver a cargar la tarjeta con la cuenta alternativa. */
export const MENSAJE_CUENTA_RECHAZADA =
  "Hubo un inconveniente con el procesador de pagos. Vuelva a ingresar los datos de su tarjeta.";
/** Ninguna cuenta del procesador pudo cobrar (todas rechazaron sus credenciales). */
export const MENSAJE_INCONVENIENTE_TECNICO =
  "No pudimos procesar el pago por un inconveniente técnico. Inténtelo nuevamente en unos minutos o elija otro medio de pago.";

/** Sin credenciales: el motivo histórico de Mercado Pago se conserva (ningún cliente lo lee). */
const motivoNoConfigurado = (procesadorId: string) =>
  procesadorId === "mercadopago" ? "mp_no_configurado" : "procesador_no_configurado";

/**
 * Cobra un pedido ya creado con el procesador `procesadorId`, con la cuenta (sucursal) que le
 * corresponde al pedido o, si no se puede, con otra del mismo procesador (`cuentaParaCobrar`). Lo comparten las rutas `POST /api/pagos/mercadopago` (URL
 * histórica) y `POST /api/pagos/[proveedor]`.
 *
 * El pedido existe ANTES de intentar cobrar: si el cobro falla, queda ahí para
 * reintentar con otro medio sin que el comprador tenga que rehacer el checkout.
 *
 * El monto NO se acepta del cliente. Sale del pedido persistido, que es el
 * total congelado en la transacción que lo creó.
 */
export async function cobrarPedido(procesadorId: string, req: Request): Promise<Response> {
  const rasgos = rasgosProcesador(procesadorId);
  if (!rasgos) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const { clerkUserId, cliente, email, registradoEn } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Sin NINGUNA cuenta del procesador configurada en el Shop no se puede cobrar nada. Se corta acá,
  // antes de leer el pedido o de hablar con el procesador. NO se exige que el medio esté activo en el
  // CRM: sólo se cobran pedidos que ya son de este procesador (más abajo), así un pedido en vuelo se
  // paga aunque el operador desactive el medio; crear pedidos nuevos ya lo bloquea POST /api/pedidos.
  // El webhook y la conciliación no pasan por acá y siguen corriendo siempre.
  if (!hayCuentaConfigurada(procesadorId)) {
    return NextResponse.json(
      {
        error:
          "El medio de pago no está disponible por el momento. Seleccione otro medio de pago o inténtelo nuevamente más tarde.",
        motivo: motivoNoConfigurado(procesadorId),
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

  // El BIN (6 a 8 dígitos) lo informa la tokenización del navegador. Se valida antes de reservar nada:
  // sin él un procesador que lo exige rechazaría el request. Mercado Pago lo usa para consultar sus planes
  // de cuotas con interés; Payway exige exactamente 6.
  const bin = typeof body.bin === "string" && /^\d{6,8}$/.test(body.bin) ? body.bin : undefined;
  if (rasgos.requiereBin && bin?.length !== 6) {
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
  if (procesadorDeMedio(pedido.pagoMetodo) !== procesadorId) {
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

  /**
   * Cuenta del cobro: la de la sucursal del pedido (`facturaSucursal ?? sucursal ?? predeterminada`), o
   * otra cuenta configurada del mismo procesador si ésa no está configurada o el procesador ya rechazó
   * sus credenciales en este pedido (`cuentaParaCobrar`). Queda congelada en el intento con la prevista.
   * La cuenta que declara el navegador (con la que tokenizó la tarjeta) se valida contra la del
   * servidor: si no coincide, se le devuelve la config vigente para volver a armar el formulario.
   */
  const declarada = body.cuenta === undefined ? undefined : texto(body.cuenta, 60);
  const elegida = await cuentaParaCobrar(procesadorId, pedido, declarada);
  if (!elegida.ok && elegida.motivo === "cuenta_no_valida") {
    const vigente = await cuentaParaCobrar(procesadorId, pedido);
    const config = vigente.ok ? configPublicaCobro(procesadorId, vigente.cuenta) : null;
    return NextResponse.json(
      {
        error: "La configuración del pago cambió. Vuelva a ingresar los datos de su tarjeta e inténtelo nuevamente.",
        motivo: "cuenta_no_valida",
        ...(config ? { config } : {}),
      },
      { status: 409 },
    );
  }
  const proveedor = elegida.ok ? proveedorPago(procesadorId, elegida.cuenta) : null;
  if (!elegida.ok || !proveedor) {
    if (!elegida.ok && (await todasRechazadas(procesadorId, pedido))) {
      // Todas las cuentas configuradas rechazaron sus credenciales en este pedido: nada más que probar.
      console.error(`[pagos] cuenta_rechazada procesador=${procesadorId} pedido=${pedido.id}: ninguna cuenta disponible`);
      return NextResponse.json({ error: MENSAJE_INCONVENIENTE_TECNICO, motivo: "cuentas_rechazadas" }, { status: 502 });
    }
    console.error(`[/api/pagos/${procesadorId}] pedido=${pedido.id}: ninguna cuenta de las sucursales tiene credenciales`);
    return NextResponse.json(
      {
        error:
          "Los pagos en línea no están disponibles en este momento. Un asesor coordinará el pago con usted.",
        motivo: motivoNoConfigurado(procesadorId),
      },
      { status: 409 },
    );
  }

  if (elegida.fallback) {
    // Queda en el intento y en `pago_info` (el CRM lo muestra); acá, para el log del momento.
    console.warn(
      `[pagos] cobro con otra cuenta procesador=${procesadorId} pedido=${pedido.id} prevista=${elegida.prevista} cuenta=${elegida.cuenta}`,
    );
  }
  const cuentas = { cuenta: elegida.cuenta, cuentaPrevista: elegida.prevista };

  const metodoPagoId = texto(body.metodoPagoId, 40) || undefined;

  // Forma de pago habilitada para el medio en el admin (crédito, débito, cuenta de Mercado Pago). Se
  // decide con lo que manda el navegador; un id desconocido cuenta como crédito. Rechazo sin reservar
  // intento ni llamar al procesador. Los medios se leen SIN caché: rige lo último del admin.
  const medios = await leerMediosPagoTolerante();
  const opcion = opcionDelCobro({ procesadorId: proveedor.id, medio, metodoPagoId });
  const rechazoOpcion = await rechazoPorOpcionDeCobro(pedido.pagoMetodo, proveedor.id, opcion, medios);
  if (rechazoOpcion) return rechazoOpcion;

  /**
   * Cuotas (ver `validarCuotasPago`): 1 pago; las sin interés congeladas en el pedido, con una tarjeta de
   * las marcas de esa condición; o las con interés que Mercado Pago ofrece para el BIN (consultadas acá,
   * con el total del pedido). Un rechazo corta ACÁ, sin reservar el intento ni llamar al procesador: el
   * navegador no decide cuántas cuotas se cobran. El monto cobrado es siempre `pedido.total` (leído de la
   * base, nunca del body). Lo validado queda como intención en el intento, para la reconciliación.
   */
  const marca =
    proveedor.id === "mercadopago"
      ? marcaDeMercadoPago(metodoPagoId)
      : proveedor.id === "payway"
        ? marcaDePayway(metodoPagoId)
        : null;
  // Condición de las cuotas congeladas. Si el admin la quitó después de congelar el pedido, sin
  // restricción de marcas (como antes de esta validación).
  const condicion = medios
    .find((m) => m.slug === pedido.pagoMetodo)
    ?.condicionesCuotas?.find((c) => c.cuotas === pedido.cuotas);
  const entradaCuotas: EntradaValidacionCuotas = {
    cuotas: body.cuotas,
    medio,
    cuotasPedido: pedido.cuotas,
    procesadorId: proveedor.id,
    opcion,
    marca,
    marcasCondicion: condicion?.marcas ?? null,
    totalPedido: pedido.total,
    planes: null,
  };
  if (requierePlanesMP(entradaCuotas)) {
    if (!bin) {
      return NextResponse.json(
        { error: "Faltan datos de la tarjeta. Vuelva a ingresarla.", motivo: "datos_invalidos" },
        { status: 422 },
      );
    }
    entradaCuotas.planes = await consultarPlanesMP({ amount: pedido.total, bin, cuenta: proveedor.cuenta });
  }
  const validacion = validarCuotasPago(entradaCuotas);
  if (!validacion.ok) {
    return NextResponse.json(
      { error: MENSAJE_RECHAZO[validacion.motivo], motivo: validacion.motivo },
      // MP no respondió: no es un error del comprador, puede reintentar en un rato.
      { status: validacion.motivo === "planes_no_disponibles" ? 503 : 422 },
    );
  }
  const { cuotas, intencion } = validacion;

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
  let reserva = await reservarIntento(pedido.id, proveedor.id, medio, intencion, cuentas);
  if (reserva && "abierto" in reserva) {
    // El intento abierto se consulta/cancela con SU cuenta (la congelada al reservarlo), no con la de hoy.
    const delIntento =
      (await proveedorDeIntento({
        proveedor: reserva.abierto.proveedor,
        cuenta: reserva.abierto.cuenta,
        sucursal: pedido.sucursal,
        facturaSucursal: pedido.facturaSucursal,
      })) ?? proveedor;
    const resolucion = await resolverIntentoAbierto(pedido.id, reserva.abierto, delIntento);
    if (resolucion === "pagado") {
      return NextResponse.json({ estado: "pagado", yaEstaba: true });
    }
    reserva = resolucion === "libre" ? await reservarIntento(pedido.id, proveedor.id, medio, intencion, cuentas) : reserva;
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
          moneda: resultado.moneda,
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

    /**
     * El procesador rechazó las credenciales de la cuenta: no hay pago. Se cierra el intento con la
     * evidencia (`credenciales_rechazadas:<cuenta>`, en la base: el reintento puede caer en otra
     * instancia) y, si hay otra cuenta usable, se le devuelve su config al navegador para que el
     * comprador vuelva a cargar la tarjeta (el token quedó atado a la public key de esta cuenta).
     */
    if (esCredencialRechazada(err)) {
      console.error(
        `[pagos] cuenta_rechazada procesador=${proveedor.id} cuenta=${proveedor.cuenta} pedido=${pedido.id} status=${err.status}`,
      );
      await registrarIntentoFallido(pedido.id, err.message).catch((e) =>
        console.error(`[/api/pagos/${proveedor.id}] no se pudo registrar el intento:`, e),
      );
      await cerrarIntentoSinPago(intentoId, detalleCredencialesRechazadas(proveedor.cuenta)).catch((e) =>
        console.error(`[/api/pagos/${proveedor.id}] no se pudo cerrar el intento:`, e),
      );
      const otra = await cuentaParaCobrar(procesadorId, pedido).catch(() => null);
      const config =
        otra?.ok && otra.cuenta !== proveedor.cuenta ? configPublicaCobro(procesadorId, otra.cuenta) : null;
      if (config) {
        return NextResponse.json(
          { error: MENSAJE_CUENTA_RECHAZADA, motivo: "cuenta_rechazada", reintentable: true, config },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: MENSAJE_INCONVENIENTE_TECNICO, motivo: "cuentas_rechazadas" }, { status: 502 });
    }

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

/** ¿El pedido se quedó sin cuenta porque TODAS las configuradas rechazaron sus credenciales? */
async function todasRechazadas(procesadorId: string, pedido: PedidoParaCuenta): Promise<boolean> {
  const { candidatas } = await candidatasDelPedido(procesadorId, pedido);
  const configuradas = candidatas.filter((c) => c.configurada);
  return configuradas.length > 0 && configuradas.every((c) => c.rechazada);
}
