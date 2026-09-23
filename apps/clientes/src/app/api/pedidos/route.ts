import { NextResponse } from "next/server";
import { identidadActual, idPriceListDe } from "@/lib/auth";
import { cotizar, normalizarLineas, MAX_LINEAS } from "@/lib/cotizacion";
import {
  evaluarEnvio,
  pagosDisponibles,
  type EntregaTipo,
  type PagoMetodo,
} from "@/lib/envio";
import { crearPedido, getPedidoPorClave, listarPedidos } from "@/lib/pedidos";
import { admiteEnvio, domicilioEnLinea } from "@/lib/facturacion";
import {
  getPerfilFacturacion,
  guardarTelefonoSiFalta,
  perfilCompleto,
} from "@/lib/facturacion-db";
import { getOfertaCuotasParaPedido } from "@/lib/cuotas-datos";
import { cuotasHabilitadas } from "@/lib/cuotas-flag";
import { pagosHabilitados } from "@/lib/pagos-flag";
import { planParaPedido } from "@/lib/pagos/cuotas-validacion";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";

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

const texto = (v: unknown, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/**
 * POST /api/pedidos — confirma el pedido.
 *
 * RE-COTIZA de cero contra Alegra en vez de confiar en la cotización que el
 * checkout ya mostró. Entre que el cliente vio el total y apretó "confirmar"
 * pueden pasar minutos: otro cliente pudo llevarse el último stock, o pudo
 * cambiar un precio. El total que se persiste es el de ESTA lectura.
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
  if (idempotencyKey) {
    const yaCreado = await getPedidoPorClave(idempotencyKey, {
      clerkUserId,
      clienteCodigo: cliente?.codigocliente,
    });
    if (yaCreado) {
      return NextResponse.json(
        { ...yaCreado, cuotasMax: await cuotasParaCliente(yaCreado.cuotasMax), repetido: true },
        { status: 200 },
      );
    }
  }

  if (!contactoNombre || !contactoTelefono) {
    return NextResponse.json(
      { error: "Faltan el nombre y el teléfono de contacto." },
      { status: 400 },
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
  // nadie puede facturar.
  const perfil = clerkUserId ? await getPerfilFacturacion(clerkUserId) : null;
  if (!perfilCompleto(perfil)) {
    return NextResponse.json(
      {
        error: "Antes de comprar necesitamos tus datos de facturación.",
        motivo: "facturacion_incompleta",
      },
      { status: 409 },
    );
  }

  // Solo se envía dentro de Argentina. El checkout ya no le ofrece el envío a
  // un comprador con documento de otro país; esto cubre el POST directo.
  if (entregaTipo === "envio" && !admiteEnvio(perfil?.pais)) {
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
      ? await idPriceListDe(cliente.codigocliente)
      : undefined;
    const cotizacion = await cotizar(lineas, { idPriceList, entregaTipo });

    // Nada se persiste si hay una sola línea con problema: se devuelve la
    // cotización entera para que el checkout marque exactamente cuál falla.
    if (cotizacion.hayProblemas) {
      return NextResponse.json(
        {
          error: "Algunos productos cambiaron. Revisá el detalle antes de confirmar.",
          cotizacion,
        },
        { status: 409 },
      );
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

    const pedido = await crearPedido(
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
        contactoTelefono,
        entregaTipo,
        entregaCiudad: entregaCiudad || undefined,
        entregaDireccion: entregaDireccion || undefined,
        pagoMetodo,
        notas: texto(body.notas, 500) || undefined,
        facturacion: perfil
          ? {
              tipoDoc: perfil.tipoDoc,
              nroDoc: perfil.nroDoc,
              razonSocial: perfil.razonSocial,
              condicionIva: perfil.condicionIva,
              domicilio: domicilioEnLinea(perfil) || undefined,
            }
          : undefined,
        // El documento coincide con un contacto de Alegra que este usuario NO
        // vinculó: un operador debe revisarlo antes de facturar, para no crear
        // un cliente duplicado con el mismo CUIT.
        requiereRevision: Boolean(perfil?.coincideConAlegra) && !cliente,
        idempotencyKey: idempotencyKey || undefined,
      },
      cotizacion,
      plan,
    );

    // El perfil aprende el teléfono del primer pedido, para no pedirlo en la
    // próxima compra. Va DESPUÉS de crear el pedido y nunca lo hace fallar: el
    // pedido ya existe y es lo que importa; el teléfono es una comodidad.
    if (clerkUserId && perfil && !perfil.telefono && !pedido.repetido) {
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
      { error: "No pudimos registrar el pedido. Probá de nuevo en un momento." },
      { status: 500 },
    );
  }
}
