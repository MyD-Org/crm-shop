import { redirect } from "next/navigation";
import { Alert, EmptyState } from "@myd-org/ui";
import { AvisoVincular } from "@/components/mi-cuenta/AvisoVincular";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { FavoritosResumen } from "@/components/mi-cuenta/FavoritosResumen";
import { PedidoCard } from "@/components/mi-cuenta/PedidoCard";
import { ResumenActividad } from "@/components/mi-cuenta/ResumenActividad";
import { SeccionTitulo } from "@/components/mi-cuenta/SeccionTitulo";
import { identidadActual } from "@/lib/auth";
import { contarNoLeidos } from "@/lib/cuenta-corriente/avisos";
import { textoNoLeidos } from "@/lib/cuenta-corriente/vista-avisos";
import { getPerfilFacturacion } from "@/lib/facturacion-db";
import { listarFavoritos } from "@/lib/favoritos";
import { rutaIngreso } from "@/lib/ingreso";
import { CAPACIDADES_DESPLIEGUE, RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";
import { pagosHabilitados } from "@/lib/pagos-flag";
import { listarPedidos, resumenPedidos } from "@/lib/pedidos";

/**
 * Resumen de Mi cuenta: tarjetas de actividad, los últimos tres pedidos y,
 * con Clerk, los cuatro favoritos más recientes.
 * Con avisos de vencimiento sin leer, un aviso arriba que lleva a Avisos (el
 * mismo contador del menú: una consulta por request, compartida con el layout).
 * Ninguna llamada a Alegra: todo sale de la base. El `?tab=datos`
 * viejo lo resuelve un redirect de next.config.ts antes de llegar acá.
 */
export default async function MiCuentaPage() {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.resumen));

  const dueno = { clerkUserId, clienteCodigo: cliente?.codigocliente };
  // Favoritos se guardan por usuario de Clerk: la cookie del CRM no los tiene.
  const conFavoritos = CAPACIDADES_DESPLIEGUE.favoritos && !!clerkUserId;
  const conAvisos = CAPACIDADES_DESPLIEGUE.avisos && !!cliente;
  const [pedidos, resumen, favoritos, perfil, noLeidos] = await Promise.all([
    listarPedidos(dueno, 3),
    resumenPedidos(dueno),
    conFavoritos && clerkUserId
      ? listarFavoritos(clerkUserId, { limite: 4, idPriceList: cliente?.idPriceList })
      : [],
    // Sólo hace falta para el aviso de vincular: sin cliente vinculado.
    clerkUserId && !cliente ? getPerfilFacturacion(clerkUserId) : null,
    // Si la lectura falla, el resumen se muestra igual, sin el aviso.
    conAvisos && cliente ? contarNoLeidos(cliente.codigocliente).catch(() => 0) : 0,
  ]);
  const sugerirVincular = Boolean(perfil?.coincideConAlegra) && !cliente;
  const pagos = await pagosHabilitados();

  return (
    <div className="flex flex-col gap-8">
      {sugerirVincular && <AvisoVincular />}

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

      <ResumenActividad enCurso={resumen.enCurso} mostrarFavoritos={conFavoritos} />

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

      {conFavoritos && <FavoritosResumen productos={favoritos} />}
    </div>
  );
}
