import { redirect } from "next/navigation";
import { EmptyState } from "@myd-org/ui";
import { BotonEnlace } from "@/components/mi-cuenta/BotonEnlace";
import { FavoritosLista } from "@/components/mi-cuenta/FavoritosLista";
import { identidadActual } from "@/lib/auth";
import { getOfertaCuotasSinCache } from "@/lib/cuotas-datos";
import { listarFavoritos } from "@/lib/favoritos";
import { rutaIngreso } from "@/lib/ingreso";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";

/**
 * Todos los favoritos del usuario (hasta el tope), del más nuevo al más viejo,
 * con el precio de su lista. Se guardan por usuario de Clerk: con la cookie del
 * CRM sin Clerk se invita a iniciar sesión, sin redirigir en bucle.
 */
export default async function FavoritosPage() {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) redirect(rutaIngreso(RUTAS_MI_CUENTA.favoritos));

  if (!clerkUserId) {
    return (
      <section>
        <EmptyState
          title="Inicie sesión con su usuario para guardar favoritos."
          action={
            <BotonEnlace href={rutaIngreso(RUTAS_MI_CUENTA.favoritos)}>Iniciar sesión</BotonEnlace>
          }
        />
      </section>
    );
  }

  const [productos, oferta] = await Promise.all([
    listarFavoritos(clerkUserId, { idPriceList: cliente?.idPriceList }),
    getOfertaCuotasSinCache(),
  ]);

  return (
    <section>
      {productos.length === 0 ? (
        <EmptyState
          title="Todavía no guardó favoritos."
          action={<BotonEnlace href="/catalogo">Ir al catálogo</BotonEnlace>}
        />
      ) : (
        <FavoritosLista productos={productos} oferta={oferta} />
      )}
    </section>
  );
}
