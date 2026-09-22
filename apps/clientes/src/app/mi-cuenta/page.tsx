import { redirect } from "next/navigation";
import { EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { PedidoCard } from "@/components/mi-cuenta/PedidoCard";
import { ResumenActividad } from "@/components/mi-cuenta/ResumenActividad";
import { SeccionTitulo } from "@/components/mi-cuenta/SeccionTitulo";
import { identidadActual } from "@/lib/auth";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";
import { pagosHabilitados } from "@/lib/pagos-flag";
import { listarPedidos, resumenPedidos } from "@/lib/pedidos";

// Los pedidos cambian con cada compra: nunca prerenderizar esta página.
export const dynamic = "force-dynamic";

/**
 * Resumen de Mi cuenta: tarjetas de actividad y los últimos tres pedidos.
 * Ninguna llamada a Alegra: todo sale de la base del Shop. El `?tab=datos`
 * viejo lo resuelve un redirect de next.config.ts antes de llegar acá.
 */
export default async function MiCuentaPage() {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.resumen));

  const dueno = { clerkUserId, clienteCodigo: cliente?.codigocliente };
  const [pedidos, resumen] = await Promise.all([listarPedidos(dueno, 3), resumenPedidos(dueno)]);
  const pagos = pagosHabilitados();

  return (
    <div className="flex flex-col gap-8">
      <ResumenActividad enCurso={resumen.enCurso} mostrarFavoritos={false} />

      <section aria-labelledby="pedidos-recientes">
        <SeccionTitulo
          id="pedidos-recientes"
          titulo="Pedidos recientes"
          href={pedidos.length > 0 ? RUTAS_MI_CUENTA.pedidos : undefined}
        />
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
    </div>
  );
}
