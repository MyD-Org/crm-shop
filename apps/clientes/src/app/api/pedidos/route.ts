import { NextResponse, after } from "next/server";
import { identidadActual, idPriceListCliente } from "@/lib/auth";
import { cotizar, normalizarLineas, MAX_LINEAS, type Cotizacion } from "@/lib/cotizacion";
import {
  evaluarEnvio,
  pagosDisponibles,
  type EntregaTipo,
  type PagoMetodo,
} from "@/lib/envio";
import { crearPedido, getPedidoPorClave, listarPedidos } from "@/lib/pedidos";
import { StockInsuficienteError } from "@/lib/stock-disponible";
import { admiteEnvio } from "@/lib/facturacion";
import { envioHabilitado } from "@/lib/envio-flag";
import { guardarTelefonoSiFalta } from "@/lib/facturacion-db";
import { congelarFacturacion, telefonoParaAlegra, validarComplemento } from "@/lib/contacto-alegra";
import { sincronizarContactoConPerfil } from "@/lib/contacto-write-through";
import { datosDelContacto, type DatosLeidos } from "@/lib/datos-del-contacto";
import { getOfertaCuotasParaPedido } from "@/lib/cuotas-datos";
import { cuotasHabilitadas } from "@/lib/cuotas-flag";
import { pagosHabilitados } from "@/lib/pagos-flag";
import { planParaPedido } from "@/lib/pagos/cuotas-validacion";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";
import { idPriceListUsable } from "@/lib/alegra";
import { idListaGeneral, vinculablePorId } from "@/lib/contactos-espejo";
import { motivoRevisionPedido, type EntradaMotivo } from "@/lib/motivo-revision";

export const dynamic = "force-dynamic";

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
}

/**
 * La clave la genera el checkout (un UUID por intento de compra). Se exige el
 * formato para que no entre cualquier cosa en una columna con índice único, y
 * porque un valor previsible —"1", el id del carrito— haría que dos clientes
 * distintos colisionaran entre sí.
 */
const CLAVE_VALIDA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El Brick sólo recibe el máximo con el flag prendido (D13). */
const cuotasParaCliente = async (cuotasMax: number | null) =>
  (await cuotasHabilitadas()) ? cuotasMax : null;

/** 409 con la cotización para que el checkout marque qué línea cambió. */
const productosCambiaron = (cotizacion: Cotizacion) =>
  NextResponse.json(
    {
      error: "Algunos productos cambiaron. Revise el detalle antes de confirmar.",
      cotizacion,
    },
    { status: 409 },
  );

/**
 * Comprador NO vinculado cuyo documento ya es de un contacto de Alegra (lo
 * anotó el perfil al guardarse, `coincideConAlegra`): la lista de precios
 * usable de ese contacto y la general, para ver si compró a otra lista que la
 * suya. Sólo espejo. Sin contacto, o si el espejo no responde ⇒ `null` (comprar
 * a precio de lista está bien: no se marca por eso).
 */
async function listaDelContactoCoincidente(
  alegraId: string | null | undefined,
): Promise<Pick<EntradaMotivo, "listaContacto" | "idListaGeneral">> {
  const sinDatos = { listaContacto: null, idListaGeneral: null };
  if (!alegraId) return sinDatos;
  try {
    const c = await vinculablePorId(alegraId);
    if (!c) return sinDatos;
    const id = idPriceListUsable(c);
    // Sin lista propia usable no hace falta saber cuál es la general.
    return { listaContacto: { id }, idListaGeneral: id ? await idListaGeneral() : null };
  } catch (err) {
    const codigo = (err as { code?: unknown })?.code;
    console.error(`[/api/pedidos] no se pudo leer el contacto coincidente (${codigo ?? "sin código"})`);
    return sinDatos;
  }
}

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
  const pagoMetodo = texto(body.pagoMetodo, 40) as PagoMetodo;

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
          { ...yaCreado, cuotasMax: await cuotasParaCliente(yaCreado.cuotasMax), repetido: true },
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
  // Con el flag `envio` apagado el checkout no ofrece el envío; esto cubre el
  // POST directo (y un checkout abierto antes de apagarlo).
  if (entregaTipo === "envio" && !(await envioHabilitado())) {
    return NextResponse.json(
      {
        error:
          "El envío a domicilio no está disponible por el momento. Seleccione retiro en el local o entrega a coordinar.",
        motivo: "envio_no_disponible",
      },
      { status: 409 },
    );
  }
  if (entregaTipo === "envio" && (!entregaCiudad || !entregaDireccion)) {
    return NextResponse.json(
      { error: "Para envío a domicilio hacen falta ciudad y dirección." },
      { status: 400 },
    );
  }
  // Se valida contra el flag de ESTE momento, no contra lo que ofreció la
  // pantalla: con los pagos apagados un POST directo con "mercadopago" se
  // rechaza igual que cualquier método no disponible, y con los pagos prendidos
  // "a_coordinar" tampoco entra.
  if (!pagosDisponibles(entregaTipo, await pagosHabilitados()).includes(pagoMetodo)) {
    return NextResponse.json(
      { error: "Ese medio de pago no está disponible para la entrega elegida." },
      { status: 400 },
    );
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
  if (entregaTipo === "envio" && !admiteEnvio(datosFactura.pais)) {
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
    // Sin cuenta corriente vinculada no hay lista propia: cotiza a la principal.
    const idPriceList = cliente
      ? await idPriceListCliente(cliente.codigocliente)
      : undefined;
    const cotizacion = await cotizar(lineas, { idPriceList, entregaTipo });

    // Nada se persiste si hay una sola línea con problema: se devuelve la
    // cotización entera para que el checkout marque exactamente cuál falla.
    if (cotizacion.hayProblemas) {
      // Un reintento cuyo primer intento se terminó de crear DESPUÉS del atajo
      // de arriba ve la reserva de ese mismo pedido y cotiza sin stock: si la
      // clave ya tiene pedido, es ése y no un 409.
      const creadoEnElMedio = await pedidoYaCreado();
      if (creadoEnElMedio) return creadoEnElMedio;
      return productosCambiaron(cotizacion);
    }

    const envio = evaluarEnvio(cotizacion.subtotal, entregaCiudad);
    if (entregaTipo === "envio" && !envio.disponible) {
      return NextResponse.json({ error: envio.motivo, cotizacion }, { status: 409 });
    }

    /**
     * Plan de cuotas congelado sobre el total RE-COTIZADO, con la oferta de la
     * DB del Shop. Nada de cuotas sale del body. Se congela también con el flag
     * apagado (así prenderlo no deja pedidos a medias). Sin oferta leíble →
     * null: el cobro usa el clamp legacy, no se bloquea la venta.
     */
    let oferta: OfertaCuotas | null = null;
    if (pagoMetodo === "mercadopago") {
      try {
        oferta = await getOfertaCuotasParaPedido();
      } catch (err) {
        console.error("[/api/pedidos] oferta de cuotas ilegible:", err);
      }
    }
    const plan = planParaPedido(pagoMetodo, cotizacion.total, oferta);

    // Para revisión de un operador antes de facturar, con el motivo más
    // importante (ver motivo-revision.ts). Comprar a la lista general NO es un
    // motivo: sólo si el documento es de un contacto con OTRA lista.
    const motivoRevision = motivoRevisionPedido({
      motivoContacto: dc.motivoRevision,
      complementoUsado,
      vinculado: Boolean(cliente),
      ...(cliente
        ? { listaContacto: null, idListaGeneral: null }
        : await listaDelContactoCoincidente(dc.perfil?.coincideConAlegra)),
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
          idPriceList,
        },
        {
          contactoNombre,
          contactoTelefono: telefonoPedido,
          entregaTipo,
          entregaCiudad: entregaCiudad || undefined,
          entregaDireccion: entregaDireccion || undefined,
          pagoMetodo,
          notas: texto(body.notas, 500) || undefined,
          // Congelado desde la lectura única: la condición real (exento, o el
          // valor de Alegra si no mapea) y el documento tal como está.
          facturacion: congelarFacturacion(datosFactura) ?? undefined,
          requiereRevision: motivoRevision !== null,
          motivoRevision,
          idempotencyKey: idempotencyKey || undefined,
        },
        cotizacion,
        plan,
      );
    } catch (err) {
      if (!(err instanceof StockInsuficienteError)) throw err;
      // Otro checkout se llevó las unidades entre la cotización y el pedido (la
      // transacción ya se deshizo). Se re-cotiza, que ya descuenta su reserva,
      // para que el checkout marque qué línea no alcanza.
      return productosCambiaron(await cotizar(lineas, { idPriceList, entregaTipo }));
    }

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
    return NextResponse.json(
      { ...pedido, cuotasMax: await cuotasParaCliente(pedido.cuotasMax), cotizacion },
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
