import { notFound, redirect } from "next/navigation";
import { PedidoDetalle } from "@/components/mi-cuenta/PedidoDetalle";
import { identidadActual } from "@/lib/auth";
import { rutaIngreso } from "@/lib/ingreso";
import { hrefPedido } from "@/lib/mi-cuenta-nav";
import { pagosHabilitados } from "@/lib/pagos-flag";
import { getPedido } from "@/lib/pedidos";
import { esIdPedido } from "@/lib/pedido-vista";

export const dynamic = "force-dynamic";

export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(hrefPedido(id)));

  // getPedido filtra por dueño: un id ajeno da 404, no 403 — no confirmamos la
  // existencia de pedidos de otras cuentas. Un id que no es uuid ni se consulta.
  if (!esIdPedido(id)) notFound();
  const pedido = await getPedido(id, { clerkUserId, clienteCodigo: cliente?.codigocliente });
  if (!pedido) notFound();

  return <PedidoDetalle pedido={pedido} pagosHabilitados={await pagosHabilitados()} />;
}
