import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { cancelarPedidoPendiente, intentoAbiertoDelPedido, lineasDelPedidoParaCarrito } from "@/lib/pedidos";
import { proveedorPago } from "@/lib/pagos";
import { resolverIntentoAbierto } from "@/lib/pagos/intento-abierto";
import { marcarStockCambiado } from "@/lib/cache-invalidar";

/**
 * POST /api/pedidos/:id/cancelar — cancela un pedido pendiente propio.
 *
 * Se llama desde el checkout cuando el comprador quiere abandonar el pedido
 * que dejó a medias y armar uno nuevo. Devuelve sus líneas (`items`) para que
 * vuelvan al carrito. El backend filtra por dueño y por
 * estado `pendiente`: sin esos filtros alguien podría adivinar ids ajenos, y
 * un pedido ya pagado no se cancela por acá — para eso está la devolución.
 *
 * Tampoco se cancela con un pago en curso: si después se aprobara, quedaría un
 * pedido cancelado y cobrado. Primero se intenta cerrar ese pago en el
 * proveedor (igual que antes de un reintento de cobro); si no se puede, 409.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "Falta el pedido" }, { status: 400 });
  }

  const dueno = { clerkUserId, clienteCodigo: cliente?.codigocliente };
  // `?para=cambiar-medio`: el comprador cancela para elegir otro medio de pago o cuotas. Las
  // validaciones son las mismas; sólo cambia la redacción de los 409.
  const paraCambiarMedio = new URL(req.url).searchParams.get("para") === "cambiar-medio";
  const accion = paraCambiarMedio ? "cambiar el medio de pago" : "cancelarlo";

  const abierto = await intentoAbiertoDelPedido(id, dueno);
  if (abierto) {
    const proveedor = proveedorPago(abierto.proveedor);
    const resolucion = proveedor
      ? await resolverIntentoAbierto(id, abierto, proveedor)
      : "en_curso";
    if (resolucion === "pagado") {
      return NextResponse.json(
        {
          error: paraCambiarMedio
            ? "Este pedido ya se pagó, así que no se puede cambiar el medio de pago. Escríbanos si necesita modificarlo."
            : "Este pedido ya se pagó, así que no se puede cancelar desde aquí. Escríbanos si necesita modificarlo.",
          motivo: "pagado",
        },
        { status: 409 },
      );
    }
    if (resolucion === "en_curso") return pagoEnCurso(accion);
  }

  const resultado = await cancelarPedidoPendiente(id, dueno);
  // Se abrió un intento entre el chequeo de arriba y la cancelación.
  if (resultado === "pago_en_curso") return pagoEnCurso(accion);
  if (resultado === "pago_informado") {
    return NextResponse.json(
      {
        error: paraCambiarMedio
          ? "Este pedido ya tiene un pago informado y no se puede cambiar el medio de pago desde la tienda. Comuníquese con nosotros."
          : "Este pedido ya tiene un pago informado y no se puede cancelar desde la tienda. Si necesita cancelarlo, comuníquese con nosotros.",
        motivo: "pago_informado",
      },
      { status: 409 },
    );
  }

  if (!resultado) {
    // Puede ser que no exista, no sea del user, o ya se haya pagado. No
    // desglosamos motivos: filtrar por el motivo real le da al atacante una
    // señal para adivinar ids.
    return NextResponse.json(
      { error: "No se pudo cancelar el pedido" },
      { status: 404 },
    );
  }

  // La cancelación liberó la reserva: el listado cacheado se renueva en la
  // próxima vista. Nunca tira.
  marcarStockCambiado("cancelar un pedido");
  // Las líneas vuelven al carrito: cancelar desde el checkout no puede dejarlo vacío.
  return NextResponse.json({ ok: true, items: await lineasDelPedidoParaCarrito(id) });
}

function pagoEnCurso(accion: string) {
  return NextResponse.json(
    {
      error: `Este pedido tiene un pago en proceso. Espere unos minutos a que se confirme antes de ${accion}.`,
      motivo: "pago_en_curso",
    },
    { status: 409 },
  );
}
