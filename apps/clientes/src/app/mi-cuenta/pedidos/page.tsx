import { redirect } from "next/navigation";
import { EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { PedidoCard } from "@/components/mi-cuenta/PedidoCard";
import { SeccionTitulo } from "@/components/mi-cuenta/SeccionTitulo";
import { identidadActual } from "@/lib/auth";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";
import { pagosHabilitados } from "@/lib/pagos-flag";
import { listarPedidos } from "@/lib/pedidos";

export const dynamic = "force-dynamic";

/** Todos los pedidos del cliente (los 50 más recientes, como antes). */
export default async function PedidosPage() {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.pedidos));

  const pedidos = await listarPedidos({ clerkUserId, clienteCodigo: cliente?.codigocliente });
  const pagos = pagosHabilitados();

  return (
    <section>
      <SeccionTitulo titulo="Pedidos" />
      {pedidos.length === 0 ? (
        <EmptyState
          title="Todavía no realizó pedidos."
          action={<BotonEnlace href="/catalogo">Ir al catálogo</BotonEnlace>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {pedidos.map((p) => (
            <PedidoCard key={p.id} pedido={p} pagosHabilitados={pagos} />
          ))}
        </div>
      )}
    </section>
  );
}
