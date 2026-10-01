import { notFound, redirect } from "next/navigation";
import { PedidoDetalle } from "@/components/mi-cuenta/PedidoDetalle";
import { identidadActual } from "@/lib/auth";
import { rutaIngreso } from "@/lib/ingreso";
import { hrefPedido } from "@/lib/mi-cuenta-nav";
import { getPedido } from "@/lib/pedidos";
import { esIdPedido } from "@/lib/pedido-vista";
import { mediosPagoCacheados } from "@/lib/medios-pago-datos";
import { instruccionesDelPago, nombreDelPago } from "@/lib/medios-pago";
import { contactoDeSucursal } from "@/lib/contacto-pedido-repo";

export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(hrefPedido(id)));

  // getPedido filtra por dueño: un id ajeno da 404, no 403 — no confirmamos la
  // existencia de pedidos de otras cuentas. Un id que no es uuid ni se consulta.
  if (!esIdPedido(id)) notFound();
  const pedido = await getPedido(id, { clerkUserId, clienteCodigo: cliente?.codigocliente });
  if (!pedido) notFound();

  // El medio de pago con su nombre (si el slug no matchea, el texto crudo de siempre) y el mismo
  // bloque de contacto de la confirmación. Un pedido cancelado no lleva bloque: no hay nadie que
  // vaya a comunicarse. Se leen todos los medios (no sólo los ofrecibles): el pedido conserva el
  // nombre de lo que eligió el comprador aunque después se haya desactivado.
  let medioPago: { nombre: string; instrucciones: string | null } | undefined;
  let contacto: Awaited<ReturnType<typeof contactoDeSucursal>> | undefined;
  const slug = pedido.pagoMetodoSlug ?? "";
  const medios = await mediosPagoCacheados();
  if (medios.some((m) => m.slug === slug)) {
    medioPago = {
      nombre: nombreDelPago(slug, medios),
      instrucciones: instruccionesDelPago(slug, medios),
    };
  }
  if (pedido.estado !== "cancelado") contacto = await contactoDeSucursal(pedido.sucursal, pedido.numero);

  return (
    <PedidoDetalle pedido={pedido} medioPago={medioPago} contacto={contacto} />
  );
}
