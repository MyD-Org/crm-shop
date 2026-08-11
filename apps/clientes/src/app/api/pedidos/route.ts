import { NextResponse } from "next/server";
import { identidadActual, idPriceListDe } from "@/lib/auth";
import { cotizar, normalizarLineas, MAX_LINEAS } from "@/lib/cotizacion";
import {
  evaluarEnvio,
  pagosDisponibles,
  type EntregaTipo,
  type PagoMetodo,
} from "@/lib/envio";
import { crearPedido, listarPedidos } from "@/lib/pedidos";
import { domicilioEnLinea } from "@/lib/facturacion";
import { getPerfilFacturacion, perfilCompleto } from "@/lib/facturacion-db";

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
}

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
  const { clerkUserId, cliente } = await identidadActual();
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
  if (!pagosDisponibles(entregaTipo).includes(pagoMetodo)) {
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

    const pedido = await crearPedido(
      {
        clerkUserId,
        codigo: cliente?.codigocliente,
        razonSocial: cliente?.razonsocial,
        cuit: cliente?.cuit,
        email: cliente?.email,
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
      },
      cotizacion,
    );

    return NextResponse.json({ ...pedido, cotizacion }, { status: 201 });
  } catch (err) {
    console.error("[/api/pedidos] POST error:", err);
    return NextResponse.json(
      { error: "No pudimos registrar el pedido. Probá de nuevo en un momento." },
      { status: 500 },
    );
  }
}
