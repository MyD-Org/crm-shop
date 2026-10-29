import { campaniasActivasEn } from "@/lib/campanias/vigentes";
import { NextResponse, after } from "next/server";
import { identidadActual } from "@/lib/auth";
import { catalogoSoloVisibles } from "@/lib/catalogo-flag";
import { variantesSelector } from "@/lib/variantes-flag";
import { cotizar, normalizarLineas, MAX_LINEAS, type Cotizacion } from "@/lib/cotizacion";
import { evaluarEnvio, type EntregaTipo } from "@/lib/envio";
import { leerConfigEnvio } from "@/lib/sucursales-repo";
import { provinciaCanonica } from "@/lib/provincias";
import { crearPedido, getPedidoPorClave, listarPedidos } from "@/lib/pedidos";
import { marcarModalidadesCambiadas, marcarStockCambiado } from "@/lib/cache-invalidar";
import { ProductoNoDisponibleError, StockInsuficienteError } from "@/lib/stock-disponible";
import { UnidadesCampaniaError } from "@/lib/campanias/unidades";
import { admiteEnvio } from "@/lib/facturacion";
import { guardarTelefonoSiFalta } from "@/lib/facturacion-db";
import { congelarFacturacion, telefonoParaAlegra, validarComplemento } from "@/lib/contacto-alegra";
import { sincronizarContactoConPerfil } from "@/lib/contacto-write-through";
import { datosDelContacto, type DatosLeidos } from "@/lib/datos-del-contacto";
import { cotizarConMedio } from "@/lib/pedido-medio";
import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import { leerMediosPagoTolerante } from "@/lib/medios-pago-repo";
import { SLUG_A_COORDINAR, esCompradorCuentaCorriente, pagoValidoConMedios } from "@/lib/medios-pago";
import { sinProcesadoresNoConfigurados } from "@/lib/medios-pago-datos";
import { listaAConfirmar } from "@/lib/medios-precio";
import { procesadorConfigurado } from "@/lib/pagos";
import { configMpPara } from "@/lib/pagos/mp-public-key";
import { contactoDelPedido } from "@/lib/contacto-pedido-repo";
import { listaPrivadaDelComprador } from "@/lib/lista-cuenta-repo";
import { motivoRevisionPedido } from "@/lib/motivo-revision";
import { avisarPedidoSiFalta, avisoOperadorAlCrear } from "@/lib/pedido-avisos";
import { SLUG_TRANSFERENCIA } from "@/lib/cuentas-bancarias";
import { permitirAsync } from "@/lib/rate-limit";
import { sucursalesHabilitadas } from "@/lib/sucursales-flag";
import { SucursalPedidoError, localDeRetiro } from "@/lib/sucursales-pedido";
import { sucursalesCacheadas } from "@/lib/sucursales-datos";
import { idsAPedido, VentaSinStockCambioError } from "@/lib/venta-sin-stock";
import { modalidadesActivas } from "@/lib/venta-sin-stock-repo";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { dispDelVisitante } from "@/lib/zona-servidor";
import { contextoUnion } from "@/lib/disponibilidad-contexto";
import { contextoParaProvincia, disponibilidadParaMostrar } from "@/lib/disponibilidad-vista";
import { claveProvincia } from "@/lib/sucursales";

/**
 * Techo de confirmaciones por comprador. Una persona real confirma un pedido,
 * y como mucho reintenta un par de veces (un 409 porque cambió un precio, un
 * corte de red): 5 por minuto sobra. Frena a un script creando pedidos en loop
 * —cada uno reserva stock y dispara un mail—. En memoria del proceso: ver los
 * límites de `permitir` en src/lib/rate-limit.ts.
 */
const MAX_PEDIDOS_POR_MINUTO = 5;

/** GET /api/pedidos — pedidos de quien está logueado. */
export async function GET() {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    return NextResponse.json(
      await listarPedidos({
        clerkUserId,
        clienteCodigo: cliente?.codigocliente,
      }),
    );
  } catch (err) {
    console.error("[/api/pedidos] GET error:", err);
    return NextResponse.json(
      { error: "No se pudieron cargar tus pedidos" },
      { status: 500 },
    );
  }
}

interface BodyPedido {
  items?: unknown;
  contactoNombre?: unknown;
  contactoTelefono?: unknown;
  entregaTipo?: unknown;
  entregaCiudad?: unknown;
  entregaDireccion?: unknown;
  pagoMetodo?: unknown;
  notas?: unknown;
  idempotencyKey?: unknown;
  /**
   * Datos de facturación que el comprador vinculado cargó en el modal y no se
   * pudieron escribir en Alegra (sólo cookie del CRM: no hay perfil donde
   * guardarlos). Se revalidan acá y el pedido queda para revisión.
   */
  complementoFacturacion?: unknown;
  /** Con el flag `sucursales`: provincia de entrega (envío) y local de retiro (slug). */
  entregaProvincia?: unknown;
  sucursalRetiro?: unknown;
  /** Total que el comprador vio en el checkout. Opcional: sin él se crea al precio actual. */
  totalVisto?: unknown;
  /** Cuotas sin interés elegidas (flag `cuotas-cobro`); ausente = un pago. Sólo cobro en línea. */
  cuotas?: unknown;
  /** Forma de pago (`credito`, `debito`, `cuenta_mp`): solo cuenta con un medio de Mercado Pago o Payway con precios por forma. */
  forma?: unknown;
  /**
   * Venta sin stock: el flujo con el que el checkout armó el pedido ("a_confirmar" = salteó Pago y
   * manda "a_coordinar"). NO decide nada (el flujo lo resuelve el servidor al cotizar): sólo elige
   * cómo se rechaza un "a_coordinar" que ya no corresponde (409 para volver a Pago en vez del 400 de
   * siempre, que siguen recibiendo los clientes que no lo mandan).
   */
  flujoVisto?: unknown;
}

/**
 * La clave la genera el checkout (un UUID por intento de compra). Se exige el
 * formato para que no entre cualquier cosa en una columna con índice único, y
 * porque un valor previsible —"1", el id del carrito— haría que dos clientes
 * distintos colisionaran entre sí.
 */
const CLAVE_VALIDA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 409 con la cotización para que el checkout marque qué línea cambió. */
const productosCambiaron = (cotizacion: Cotizacion) =>
  NextResponse.json(
    {
      error: "Algunos productos cambiaron. Revise el detalle antes de confirmar.",
      cotizacion,
    },
    { status: 409 },
  );

/** Medio no aplicable a la entrega elegida (también el "a_coordinar" pendiente de un pedido normal). */
const medioNoDisponible = () =>
  NextResponse.json(
    { error: "Ese medio de pago no está disponible para la entrega elegida." },
    { status: 400 },
  );

const texto = (v: unknown, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/**
 * POST /api/pedidos — confirma el pedido.
 *
 * RE-COTIZA en el servidor (mismo espejo y misma lista que el checkout) en vez
 * de confiar en montos del body: el precio nunca viaja desde el browser. Los
 * precios que valen son los que publica la tienda; no se consulta Alegra.
 */
export async function POST(req: Request) {
  // Alcanza con estar logueado: quien no vinculó cuenta corriente compra igual,
  // a lista general. La vinculación da precios propios, no permiso de comprar.
  const { clerkUserId, cliente, email } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Cuenta también los reintentos con la misma clave: son baratos, pero un
  // loop que repite la clave tampoco es una persona.
  const quien = clerkUserId ? `clerk:${clerkUserId}` : `cliente:${cliente!.codigocliente}`;
  if (!await permitirAsync(`pedidos:${quien}`, MAX_PEDIDOS_POR_MINUTO, 60_000)) {
    return NextResponse.json(
      { error: "Hizo demasiados intentos de confirmar el pedido. Espere un minuto e inténtelo de nuevo." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let body: BodyPedido;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  // --- Validación de los datos del formulario ---
  const contactoNombre = texto(body.contactoNombre, 120);
  const contactoTelefono = texto(body.contactoTelefono, 40);
  const entregaTipo: EntregaTipo =
    body.entregaTipo === "envio" ? "envio" : "retiro";
  const entregaCiudad = texto(body.entregaCiudad, 80);
  const entregaDireccion = texto(body.entregaDireccion, 200);
  const pagoMetodo = texto(body.pagoMetodo, 40);

  const idempotencyKey = texto(body.idempotencyKey, 40);
  if (idempotencyKey && !CLAVE_VALIDA.test(idempotencyKey)) {
    return NextResponse.json(
      { error: "Clave de pedido inválida." },
      { status: 400 },
    );
  }

  /**
   * Atajo del reintento: si esta clave ya creó un pedido, se devuelve ese y se
   * corta acá. Sin esto, un reintento vuelve a cotizar contra Alegra —hasta 60
   * llamadas— para terminar descubriendo lo mismo.
   *
   * No es la garantía contra duplicados: eso lo hace el índice único dentro de
   * `crearPedido`. Dos requests simultáneos pasarían los dos por este chequeo.
   */
  const pedidoYaCreado = async () => {
    if (!idempotencyKey) return null;
    const yaCreado = await getPedidoPorClave(idempotencyKey, {
      clerkUserId,
      clienteCodigo: cliente?.codigocliente,
    });
    return yaCreado
      ? NextResponse.json(
          { ...yaCreado, repetido: true },
          { status: 200 },
        )
      : null;
  };
  const yaCreado = await pedidoYaCreado();
  if (yaCreado) return yaCreado;

  // Al vinculado el teléfono le puede llegar del espejo de Alegra (se decide
  // más abajo, con la lectura única): acá sólo se exige a quien no lo tiene.
  if (!contactoNombre || (!contactoTelefono && !cliente)) {
    return NextResponse.json(
      { error: "Faltan el nombre y el teléfono de contacto." },
      { status: 400 },
    );
  }
  // Desde `envio-gratis-configurable` el envío siempre es a domicilio (ciudad y dirección): el
  // "Envío a coordinar" aparte se fusionó con él (si no es gratis, el costo se coordina).
  const aDomicilio = entregaTipo === "envio";
  // La configuración se relee SIN caché: la UI puede mostrar lo que había hace minutos, el
  // servidor decide con lo de ahora. Un pedido a domicilio NUNCA se rechaza por no ser gratis
  // (se crea sin cobrar envío, el costo se coordina); sólo si el admin apagó el envío.
  const configEnvio = aDomicilio ? await leerConfigEnvio() : null;
  if (aDomicilio && configEnvio && !configEnvio.domicilioActivo) {
    return NextResponse.json(
      {
        error: "El envío a domicilio no está disponible. Elija retiro en el local.",
        motivo: "envio_inactivo",
      },
      { status: 409 },
    );
  }
  if (aDomicilio && (!entregaCiudad || !entregaDireccion)) {
    return NextResponse.json(
      { error: "Para envío a domicilio hacen falta ciudad y dirección." },
      { status: 400 },
    );
  }
  // La provincia sale del CUERPO del pedido (no de la cookie de zona) y es obligatoria, canónica,
  // para el envío a domicilio: de ella depende si es gratis.
  const entregaProvincia = aDomicilio ? provinciaCanonica(texto(body.entregaProvincia, 80)) : null;
  if (aDomicilio && !entregaProvincia) {
    return NextResponse.json(
      { error: "Indique la provincia de entrega." },
      { status: 400 },
    );
  }
  // Se valida contra lo de ESTE momento, no contra lo que ofreció la pantalla: el método es el
  // `slug` de un medio activo del CRM que aplica a la modalidad (releídos SIN caché: la decisión
  // que escribe un pedido no usa lo cacheado). un medio con cobro en línea además exige credenciales de su procesador en el Shop.
  // Si ningún medio aplica (tabla ausente, vacía o sin medios para la modalidad) sólo vale
  // "a_coordinar"; con medios aplicables, "a_coordinar" no entra.
  //
  // Cuenta corriente: la identidad sale del servidor (nunca del body). Quien la tiene SÓLO puede
  // pagar con el medio de audiencia `cuenta_corriente` (sin cobro en línea ni cuotas); si ese medio
  // no está activo, el pedido sale "a_coordinar". Quien no la tiene no puede usar ese medio.
  //
  // Venta sin stock: "a_coordinar" con medios aplicables queda PENDIENTE del flujo del pedido, que se
  // conoce recién al cotizar: vale si el pedido queda a confirmar por una modalidad; si no, es el
  // mismo 400 de siempre (o un 409 si el checkout lo armó a confirmar, ver más abajo). Cuenta
  // corriente: sin cambios (su medio, o "a_coordinar" si no está activo).
  const mediosCrm = await leerMediosPagoTolerante();
  const opcionesMedios = {
    procesadorDisponible: procesadorConfigurado,
    esCuentaCorriente: esCompradorCuentaCorriente(cliente),
  };
  const pagoValido = pagoValidoConMedios(mediosCrm, entregaTipo, pagoMetodo, opcionesMedios);
  const aCoordinarPendiente =
    !pagoValido && pagoMetodo === SLUG_A_COORDINAR && !opcionesMedios.esCuentaCorriente;
  if (!pagoValido && !aCoordinarPendiente) {
    // El medio aplica pero su procesador no tiene NINGUNA cuenta con credenciales en el Shop. (Que la
    // cuenta de la sucursal del pedido no esté configurada no se decide acá: lo resuelve el cobro.)
    const sinCuentas = pagoValidoConMedios(mediosCrm, entregaTipo, pagoMetodo, {
      ...opcionesMedios,
      procesadorDisponible: () => true,
    });
    if (sinCuentas) {
      return NextResponse.json(
        {
          error: "El medio de pago elegido no está disponible por el momento. Seleccione otro medio de pago.",
          motivo: "procesador_no_configurado",
        },
        { status: 409 },
      );
    }
    return medioNoDisponible();
  }

  const lineas = normalizarLineas(body.items);
  if (lineas.length === 0) {
    return NextResponse.json({ error: "El carrito está vacío." }, { status: 400 });
  }
  if (Array.isArray(body.items) && body.items.length > MAX_LINEAS) {
    return NextResponse.json(
      { error: `El pedido no puede tener más de ${MAX_LINEAS} productos distintos.` },
      { status: 400 },
    );
  }

  // --- Facturación ---
  // Sin datos fiscales no se puede emitir el comprobante, así que no se acepta
  // el pedido: es preferible frenarlo acá que registrar una venta que después
  // nadie puede facturar. La MISMA lectura que el checkout y Mis datos
  // (`datosDelContacto`): vinculado ⇒ espejo de Alegra; no vinculado ⇒ perfil.
  const dc = await datosDelContacto({ clerkUserId, cliente });
  let datosFactura: DatosLeidos = dc.datos;
  let complementoUsado = false;
  if (!dc.completo) {
    const entrada = body.complementoFacturacion;
    if (dc.interno && entrada && typeof entrada === "object" && !Array.isArray(entrada)) {
      // Sólo claves que faltan y con las mismas reglas que el modal (D1).
      const r = validarComplemento(dc.interno.lectura, entrada as Record<string, unknown>);
      if (r.ok) {
        datosFactura = r.datos;
        complementoUsado = true;
      }
    }
    if (!complementoUsado) {
      if (dc.fuente === "no_disponible") {
        return NextResponse.json(
          {
            error: "No pudimos obtener sus datos de facturación. Inténtelo de nuevo en unos minutos.",
            motivo: "facturacion_no_disponible",
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          error: "Cargue sus datos de facturación para continuar.",
          motivo: "facturacion_incompleta",
          faltantes: dc.faltantes,
        },
        { status: 409 },
      );
    }
  }

  // Teléfono del pedido: el tipeado; si no vino, el de Alegra (el checkout
  // lo precarga y el espejo es la fuente: no hace falta volver a tipearlo).
  const telefonoPedido = contactoTelefono || dc.telefonoAlegra || "";
  if (!telefonoPedido) {
    return NextResponse.json(
      { error: "Faltan el nombre y el teléfono de contacto." },
      { status: 400 },
    );
  }

  // Solo se envía dentro de Argentina. El checkout ya no le ofrece el envío a
  // un comprador con documento de otro país; esto cubre el POST directo.
  if (aDomicilio && !admiteEnvio(datosFactura.pais)) {
    return NextResponse.json(
      {
        error:
          "El envío a domicilio solo está disponible para compradores de Argentina. Seleccione retiro en el local.",
        motivo: "envio_no_disponible_pais",
      },
      { status: 409 },
    );
  }

  try {
    // Lista PRIVADA del comprador (cuenta corriente con lista enlazada): sólo desde su sesión, jamás
    // del body. Sin ella (contado, sin enlace, sin vincular) rige el precio público o el del medio.
    const idListaPrivada = cliente ? await listaPrivadaDelComprador() : null;
    // Con el flag `sucursales`: los datos con los que `crearPedido` asigna la sucursal. Provincia
    // de entrega: la del body, si no la zona elegida (cookie), si no la del domicilio de facturación.
    // Apagado = undefined y el pedido queda sin sucursal, como siempre.
    const sucursalEntrada = (await sucursalesHabilitadas())
      ? {
          entregaTipo,
          provincia: claveProvincia(texto(body.entregaProvincia, 80)) || null,
          ciudad: entregaCiudad || null,
          sucursalRetiro: entregaTipo === "retiro" ? texto(body.sucursalRetiro, 20) || null : null,
        }
      : undefined;
    if (sucursalEntrada && !sucursalEntrada.provincia) {
      // Sin provincia de entrega: la de la ubicación del visitante y, si no, la del domicilio fiscal.
      // (La cookie `shop_zona` del selector viejo ya no se lee.)
      const { ubicacion } = await ubicacionDelVisitante().catch(() => ({ ubicacion: null }));
      sucursalEntrada.provincia = ubicacion?.provincia ?? (claveProvincia(datosFactura.domicilioProvincia) || null);
    }

    // Flag `disponibilidad-sucursal`: stock por sucursal. La cotización cuenta la UNIÓN de las
    // sucursales activas (permisiva); la decisión definitiva por modalidad la toma `crearPedido`.
    const dispBase = sucursalEntrada ? await dispDelVisitante() : undefined;
    const disp = dispBase
      ? await contextoParaProvincia(dispBase, entregaTipo === "envio" ? sucursalEntrada?.provincia : null)
      : undefined;
    const dispCotizacion = disp ? contextoUnion(disp) : undefined;
    const soloVisibles = await catalogoSoloVisibles();
    // Flag `variantes-selector`: el overlay (visibilidad) es el del ancla del grupo. Apagado = como siempre.
    const agrupar = await variantesSelector();
    // Venta sin stock con el flag: la disponibilidad va ANTES de cotizar y decide qué líneas van a
    // pedido con las reglas reales (`origenDeLinea`), el mismo motor y el mismo local que el carrito.
    // null (flag apagado o falla) = decide el stock de la cotización. Nunca hace fallar el pedido.
    // Sin modalidades activas ninguna línea puede ir a pedido: no se consulta el motor (la cotización
    // lee la misma lista cacheada, así que el resultado es idéntico).
    let aPedido: Set<string> | undefined;
    if (disp && sucursalEntrada && (await modalidadesActivas()).length > 0) {
      try {
        const disponibilidad = await disponibilidadParaMostrar(
          lineas.map((l) => l.id),
          disp,
          Object.fromEntries(lineas.map((l) => [l.id, l.qty])),
          agrupar,
        );
        if (disponibilidad) {
          const local =
            entregaTipo === "retiro"
              ? (sucursalEntrada.sucursalRetiro ?? localDeRetiro(sucursalEntrada, await sucursalesCacheadas()))
              : null;
          aPedido = idsAPedido(disponibilidad.productos, { tipo: entregaTipo, local });
        }
      } catch (err) {
        console.error("[/api/pedidos] disponibilidad para las líneas a pedido:", err);
        aPedido = undefined;
      }
    }
    // Precio por medio de pago, cuotas y lista: una sola resolución para crear y para cambiar el medio
    // (`cotizarConMedio`). La lista sale del slug ya validado (medios releídos sin caché más arriba),
    // nunca del body. Un pedido a confirmar por modalidad (sin cuenta corriente) se cotiza con la lista
    // que muestran las cards, como en el carrito.
    // Campañas de precios activas AHORA, leídas sin caché (lo que cobra va siempre en vivo).
    const campanias = await campaniasActivasEn(new Date());
    const resuelto = await cotizarConMedio({
      lineas,
      entregaTipo,
      pagoMetodo,
      cuotasPedidas: body.cuotas,
      formaPedida: body.forma,
      mediosCrm,
      opcionesMedios,
      idListaPrivada,
      disp: dispCotizacion,
      soloVisibles,
      ...(agrupar ? { agrupar: true } : {}),
      ...(aPedido ? { aPedido } : {}),
      ...(opcionesMedios.esCuentaCorriente
        ? {}
        : { idListaAConfirmar: listaAConfirmar(sinProcesadoresNoConfigurados(mediosCrm)) }),
      ...(campanias.length ? { campanias } : {}),
    });
    if (!resuelto.ok) {
      if (resuelto.motivo === "forma_no_disponible") {
        return NextResponse.json(
          { error: "Esa forma de pago no está disponible para este medio.", motivo: "forma_no_disponible" },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: TEXTOS_CUOTAS.cuotasNoDisponibles, motivo: "cuotas_no_disponibles" },
        { status: 422 },
      );
    }
    const { cuotasPedido, idListaMedio, formaCobro, opcionesCotizar, cotizacion } = resuelto;

    // Nada se persiste si hay una sola línea con problema: se devuelve la
    // cotización entera para que el checkout marque exactamente cuál falla.
    if (cotizacion.hayProblemas) {
      // Un reintento cuyo primer intento se terminó de crear DESPUÉS del atajo
      // de arriba ve la reserva de ese mismo pedido y cotiza sin stock: si la
      // clave ya tiene pedido, es ése y no un 409.
      const creadoEnElMedio = await pedidoYaCreado();
      if (creadoEnElMedio) return creadoEnElMedio;
      // Con lista privada, un producto sin precio en ella ("Consulte") no se puede confirmar.
      if (cotizacion.lineas.some((l) => l.sinPrecio)) {
        return NextResponse.json(
          {
            error: "Hay productos sin precio para su cuenta. Quítelos o consulte con un asesor.",
            motivo: "sin_precio_cuenta",
            cotizacion,
          },
          { status: 409 },
        );
      }
      return productosCambiaron(cotizacion);
    }

    // Flujo del pedido (venta sin stock). Cuenta corriente: sin cambios, sigue con su medio.
    // - A confirmar: sólo "a_coordinar"; un medio en línea nunca se pisa en silencio (409, el checkout
    //   vuelve a mostrar el pedido).
    // - Normal: un "a_coordinar" pendiente es el 400 de siempre. Salvo que el checkout lo haya armado a
    //   confirmar (`flujoVisto`) y el pedido dejó de serlo con el checkout abierto (entró stock o la
    //   modalidad pasó a en línea): 409 con la cotización, para que el checkout recotice y vuelva a
    //   mostrar el paso Pago. Sin `flujoVisto` (un cliente que no pasó por ese flujo), el 400.
    // Un reintento cuyo primer intento ya se creó puede leer su propia reserva y cambiar de flujo: si la
    // clave ya tiene pedido, es ése.
    const aConfirmar = cotizacion.flujo === "a_confirmar" && !opcionesMedios.esCuentaCorriente;
    if (aConfirmar && pagoMetodo !== SLUG_A_COORDINAR) {
      const creadoEnElMedio = await pedidoYaCreado();
      if (creadoEnElMedio) return creadoEnElMedio;
      return NextResponse.json(
        {
          error: "Su pedido incluye productos que se confirman por contacto. Revise el pedido para continuar.",
          motivo: "pedido_a_confirmar",
          cotizacion,
        },
        { status: 409 },
      );
    }
    if (aCoordinarPendiente && !aConfirmar && body.flujoVisto === "a_confirmar") {
      const creadoEnElMedio = await pedidoYaCreado();
      if (creadoEnElMedio) return creadoEnElMedio;
      return NextResponse.json(
        {
          error: "Su pedido ya no se confirma por contacto: elija un medio de pago.",
          motivo: "pedido_ya_no_a_confirmar",
          cotizacion,
        },
        { status: 409 },
      );
    }
    if (
      aCoordinarPendiente &&
      !(aConfirmar && pagoValidoConMedios(mediosCrm, entregaTipo, pagoMetodo, { ...opcionesMedios, aConfirmar: true }))
    ) {
      const creadoEnElMedio = await pedidoYaCreado();
      if (creadoEnElMedio) return creadoEnElMedio;
      return medioNoDisponible();
    }

    // El comprador confirma lo que vio: si el total recotizado difiere (el precio
    // cambió con el checkout abierto) no se crea nada y se le muestra el nuevo.
    // Un reintento idempotente ya volvió arriba, así que no llega acá.
    const totalVisto = typeof body.totalVisto === "number" && Number.isFinite(body.totalVisto) ? body.totalVisto : null;
    if (totalVisto !== null && Math.abs(totalVisto - cotizacion.total) >= 0.005) {
      return NextResponse.json(
        {
          error: "El precio de algunos productos cambió. Revise el nuevo total antes de confirmar.",
          motivo: "precio_cambio",
          totalNuevo: cotizacion.total,
          cotizacion,
        },
        { status: 409 },
      );
    }

    // `null` = retiro (no aplica); true/false = envío a domicilio gratis o a coordinar.
    const envioGratis =
      aDomicilio && configEnvio ? evaluarEnvio(cotizacion.subtotal, entregaProvincia, configEnvio).gratis : null;


    // Para revisión de un operador antes de facturar, con el motivo más
    // importante (ver motivo-revision.ts). El precio ya no depende de la lista del contacto de
    // Alegra (la lista privada se resuelve aparte), así que "otra lista de precios" no es motivo.
    const motivoRevision = motivoRevisionPedido({
      motivoContacto: dc.motivoRevision,
      complementoUsado,
      vinculado: Boolean(cliente),
      listaContacto: null,
      idListaGeneral: null,
    });

    let pedido: Awaited<ReturnType<typeof crearPedido>>;
    try {
      pedido = await crearPedido(
        {
          clerkUserId,
          codigo: cliente?.codigocliente,
          razonSocial: cliente?.razonsocial,
          cuit: cliente?.cuit,
          /**
           * El email del contacto de Alegra, y si no hay, el de la cuenta con la
           * que entró.
           *
           * Antes era solo el de Alegra, así que quien NO vinculó cuenta corriente
           * —o sea casi todo el mundo— quedaba con `cliente_email` en null. Eso
           * después rompe el cobro: Mercado Pago exige `payer.email` y responde
           * "Params Error" sin decir cuál falta.
           */
          email: cliente?.email ?? email,
          // La lista efectivamente usada para cotizar, congelada con el pedido: la privada del comprador
          // (uuid de la lista online) o, sin ella, la del medio.
          idPriceList: idListaPrivada ?? idListaMedio,
        },
        {
          contactoNombre,
          contactoTelefono: telefonoPedido,
          entregaTipo,
          entregaCiudad: entregaCiudad || undefined,
          entregaDireccion: entregaDireccion || undefined,
          envioGratis,
          pagoMetodo,
          cuotas: cuotasPedido,
          formaCobro,
          notas: texto(body.notas, 500) || undefined,
          // Congelado desde la lectura única: la condición real (exento, o el
          // valor de Alegra si no mapea) y el documento tal como está.
          facturacion: congelarFacturacion(datosFactura) ?? undefined,
          requiereRevision: motivoRevision !== null,
          motivoRevision,
          idempotencyKey: idempotencyKey || undefined,
          sucursalEntrada,
          disponibilidadSucursal: disp !== undefined,
          soloVisibles,
          ...(agrupar ? { agrupar: true } : {}),
        },
        cotizacion,
      );
    } catch (err) {
      if (err instanceof SucursalPedidoError) {
        return NextResponse.json(
          { error: err.message, motivo: err.codigo, ...(err.ids.length > 0 ? { ids: err.ids } : {}) },
          { status: 409 },
        );
      }
      if (err instanceof ProductoNoDisponibleError) {
        // Se despublicó entre la cotización y el pedido: se re-cotiza para marcar la línea.
        const recotizada = await cotizar(lineas, opcionesCotizar);
        return NextResponse.json({ error: err.message, cotizacion: recotizada, ids: err.ids }, { status: 409 });
      }
      if (err instanceof UnidadesCampaniaError) {
        // Otro checkout se llevó las últimas unidades a precio de campaña: se re-cotiza (ya con lo
        // que queda, o el precio normal si se agotaron) para que el checkout marque la línea.
        const recotizada = await cotizar(lineas, opcionesCotizar);
        return NextResponse.json(
          {
            error: "Ya no quedan suficientes unidades a precio de campaña de un producto. Revise el carrito.",
            motivo: "unidades_campania",
            quedan: err.quedan,
            ids: err.ids,
            cotizacion: recotizada,
          },
          { status: 409 },
        );
      }
      if (!(err instanceof StockInsuficienteError) && !(err instanceof VentaSinStockCambioError)) throw err;
      // Otro checkout se llevó las unidades entre la cotización y el pedido, o la modalidad de venta
      // sin stock de una línea se desactivó o cambió de flujo (la transacción ya se deshizo). Se
      // re-cotiza (con las mismas líneas a pedido y la misma lista), que ya descuenta su reserva y lee
      // la modalidad de ahora, para que el checkout marque qué línea cambió. Si fue la modalidad, la
      // lista cacheada quedó vieja (p. ej. se perdió el aviso del CRM): se vence para que el
      // reintento cotice con la de ahora y no choque igual hasta el TTL.
      if (err instanceof VentaSinStockCambioError) marcarModalidadesCambiadas();
      return productosCambiaron(await cotizar(lineas, opcionesCotizar));
    }

    // El pedido reservó stock: el listado cacheado se renueva en la próxima
    // vista (stale-while-revalidate). Nunca tira.
    if (!pedido.repetido) marcarStockCambiado("crear un pedido");

    if (!pedido.repetido && motivoRevision) {
      // Sin datos: el id del pedido y el motivo.
      console.warn(`[/api/pedidos] pedido ${pedido.id} para revisión: ${motivoRevision}`);
    }

    // Sin demorar la respuesta, UNA subida a Alegra que junta:
    // - lo de facturación que quedó sólo en el perfil (un PUT que falló);
    // - el teléfono tipeado, si Alegra no tiene ninguno (sólo completar
    //   vacíos: la subida lo vuelve a mirar contra el contacto fresco).
    const mixto = dc.fuente === "mixto";
    const subirTelefono = Boolean(dc.interno && !dc.telefonoAlegra && telefonoParaAlegra(contactoTelefono));
    if ((mixto || subirTelefono) && dc.alegraId && !pedido.repetido) {
      const alegraId = dc.alegraId;
      after(() =>
        sincronizarContactoConPerfil(alegraId, {
          clerkUserId,
          ...(subirTelefono ? { telefono: contactoTelefono } : {}),
        }),
      );
    }

    // "Recibimos su pedido", sin demorar la respuesta. Un pedido repetido (mismo
    // idempotencyKey) ya tuvo su mail. Con cobro en línea no se manda acá: el comprador recibe un
    // solo mail ("pedido y pago") cuando se aprueba el cobro.
    if (!pedido.repetido) {
      const pedidoId = pedido.id;
      // Y el aviso al local (sucursal del pedido, o el email de la empresa), en el mismo after():
      // ninguno de los dos lanza, y el del comprador sale primero. Con pago en línea ambos
      // esperan a que se apruebe el cobro (los manda `avisarCobro`).
      // Con transferencia se espera: el comprador todavía puede cambiar el medio desde la pantalla de
      // transferencia. Los avisos salen al irse de ella, al informar el comprobante o desde el cron
      // (`avisarPedidoSiFalta`), con el medio que tenga el pedido entonces.
      if (avisoOperadorAlCrear(pagoMetodo) && pagoMetodo !== SLUG_TRANSFERENCIA) {
        after(() => avisarPedidoSiFalta(pedidoId).then(() => undefined));
      }
    }

    // El perfil aprende el teléfono del primer pedido, para no pedirlo en la
    // próxima compra (sin perfil, crea la fila "sólo teléfono"). Va DESPUÉS de
    // crear el pedido y nunca lo hace fallar: el pedido ya existe y es lo que
    // importa; el teléfono es una comodidad.
    if (clerkUserId && contactoTelefono && !dc.perfil?.telefono && !dc.telefonoAlegra && !pedido.repetido) {
      try {
        await guardarTelefonoSiFalta(clerkUserId, contactoTelefono);
      } catch (err) {
        console.error("[/api/pedidos] no se pudo guardar el teléfono en el perfil:", err);
      }
    }

    // 200 y no 201 cuando la clave ya existía: no se creó nada nuevo. El
    // checkout trata los dos casos igual —muestra el número— pero la diferencia
    // importa para cualquiera que lea los logs.
    // Plazo prometido y WhatsApp de la sucursal asignada. Nunca hace fallar la respuesta (el pedido
    // ya existe): sin datos, la pantalla usa el texto genérico.
    const contacto = await contactoDelPedido(pedido.id, pedido.numero);

    return NextResponse.json(
      { ...pedido, cotizacion, ...(contacto ? { contacto } : {}), ...(await configMpPara(pedido.id, pagoMetodo)) },
      { status: pedido.repetido ? 200 : 201 },
    );
  } catch (err) {
    console.error("[/api/pedidos] POST error:", err);
    return NextResponse.json(
      { error: "No pudimos registrar el pedido. Inténtelo de nuevo en un momento." },
      { status: 500 },
    );
  }
}
