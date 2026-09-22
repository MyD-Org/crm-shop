"use client";

import { StatCard, cn } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { useCart } from "@/context/CartContext";
import { useFavoritos } from "@/context/FavoritosContext";
import { etiquetaContador } from "@/lib/mi-cuenta-copy";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";
import { IconoCarrito, IconoCorazon, IconoPedidos } from "./iconos";

/**
 * Tarjetas del resumen. Pedidos en curso llega del servidor; el carrito vive
 * en el navegador, así que su tarjeta muestra el esqueleto hasta que el
 * carrito se hidrata (mismo HTML en el server y en el primer render: sin
 * warning de hidratación).
 *
 * `mostrarFavoritos` suma la tercera tarjeta (usuario de Clerk con la
 * capacidad desplegada). Su número son las filas guardadas que trae el
 * provider, así que también espera a `ready`.
 */
export function ResumenActividad({
  enCurso,
  mostrarFavoritos = false,
}: {
  enCurso: number;
  mostrarFavoritos?: boolean;
}) {
  const { count, ready } = useCart();
  const favoritos = useFavoritos();

  return (
    <div className={cn("grid gap-4", mostrarFavoritos ? "md:grid-cols-3" : "md:grid-cols-2")}>
      <StatCard
        icon={<IconoPedidos size={22} />}
        value={enCurso}
        label={etiquetaContador(enCurso, "Pedido en curso", "Pedidos en curso")}
        href={RUTAS_MI_CUENTA.pedidos}
        renderLink={linkNext}
      />
      <StatCard
        icon={<IconoCarrito size={22} />}
        value={ready ? count : undefined}
        loading={!ready}
        label={etiquetaContador(count, "Producto en el carrito", "Productos en el carrito")}
        href="/carrito"
        renderLink={linkNext}
      />
      {mostrarFavoritos && (
        <StatCard
          icon={<IconoCorazon size={22} />}
          value={favoritos.ready ? favoritos.count : undefined}
          loading={!favoritos.ready}
          label={etiquetaContador(favoritos.count, "Favorito guardado", "Favoritos guardados")}
          href={RUTAS_MI_CUENTA.favoritos}
          renderLink={linkNext}
        />
      )}
    </div>
  );
}
