import { redirect } from "next/navigation";
import { Alert, EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { PedidoCard } from "@/components/mi-cuenta/PedidoCard";
import { ResumenActividad } from "@/components/mi-cuenta/ResumenActividad";
import { accesoFacturacion } from "@/lib/acceso-facturacion";
import { identidadActual } from "@/lib/auth";
import { contarNoLeidos } from "@/lib/cuenta-corriente/avisos";
import { textoNoLeidos } from "@/lib/cuenta-corriente/vista-avisos";
import { rutaIngreso } from "@/lib/ingreso";
import { CAPACIDADES_DESPLIEGUE, RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";
import { listarPedidos, resumenPedidos } from "@/lib/pedidos";

/**
 * Pedidos de Mi cuenta (los 50 más recientes), con arriba las tarjetas de
 * actividad (pedidos en curso y carrito) y, sólo a cuenta corriente con avisos
 * de vencimiento sin leer, un aviso que lleva a Avisos (mismo contador y mismo
 * acceso que el menú del layout). Ninguna llamada a Alegra.
 */
export default async function PedidosPage() {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.pedidos));

  const dueno = { clerkUserId, clienteCodigo: cliente?.codigocliente };
  // Avisos es de Facturación: sólo cuenta corriente (lectura compartida con el layout).
  const conAvisos = CAPACIDADES_DESPLIEGUE.avisos && !!cliente && (await accesoFacturacion());
  const [pedidos, resumen, noLeidos] = await Promise.all([
    listarPedidos(dueno),
    resumenPedidos(dueno),
    // Si la lectura falla, la página se muestra igual, sin el aviso.
    conAvisos && cliente ? contarNoLeidos(cliente.codigocliente).catch(() => 0) : 0,
  ]);

  return (
    <div className="flex flex-col gap-8">
      {noLeidos > 0 && (
        <Alert tone="warning" title={textoNoLeidos(noLeidos)}>
          <p>Consulte los vencimientos de sus facturas y las novedades de su cuenta.</p>
          <div className="mt-3">
            <BotonEnlace size="sm" href={RUTAS_MI_CUENTA.avisos}>
              Ver avisos
            </BotonEnlace>
          </div>
        </Alert>
      )}

      <ResumenActividad enCurso={resumen.enCurso} />

      <section>
        {pedidos.length === 0 ? (
          <EmptyState
            title="Todavía no realizó pedidos."
            action={<BotonEnlace href="/catalogo">Ir al catálogo</BotonEnlace>}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {pedidos.map((p) => (
              <PedidoCard key={p.id} pedido={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
