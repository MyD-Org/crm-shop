import { MigasMiCuenta } from "@/components/mi-cuenta/MigasMiCuenta";
import { identidadActual } from "@/lib/auth";
import { hrefPedido, migasMiCuenta } from "@/lib/mi-cuenta-nav";
import { getPedido } from "@/lib/pedidos";
import { esIdPedido } from "@/lib/pedido-vista";

export const dynamic = "force-dynamic";

/**
 * Migas del detalle: Inicio / Mi cuenta / Pedidos / PED-…. El número sale del
 * mismo `getPedido` (en `cache()`) que usa la página: una sola consulta. Sin
 * identidad o con un id que no es de un pedido no se consulta la base.
 */
export default async function MigasPedido({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const items = migasMiCuenta(hrefPedido(id));

  const { clerkUserId, cliente } = await identidadActual();
  if ((clerkUserId || cliente) && esIdPedido(id)) {
    const pedido = await getPedido(id, { clerkUserId, clienteCodigo: cliente?.codigocliente });
    if (pedido) items.push({ label: pedido.numero });
  }

  return <MigasMiCuenta items={items} />;
}
