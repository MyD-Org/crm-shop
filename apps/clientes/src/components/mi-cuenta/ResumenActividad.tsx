"use client";

import { StatCard } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { useCart } from "@/context/CartContext";
import { etiquetaContador } from "@/lib/mi-cuenta-copy";
import { RUTAS_MI_CUENTA } from "@/lib/mi-cuenta-nav";
import { IconoCarrito, IconoPedidos } from "./iconos";

/**
 * Tarjetas del resumen. Pedidos en curso llega del servidor; el carrito vive
 * en el navegador, así que su tarjeta muestra el esqueleto hasta que el
 * carrito se hidrata (mismo HTML en el server y en el primer render: sin
 * warning de hidratación).
 *
 * `mostrarFavoritos` queda reservado para la tercera tarjeta (rebanada de
 * favoritos); mientras la capacidad esté apagada no se pinta nada.
 */
export function ResumenActividad({
  enCurso,
}: {
  enCurso: number;
  mostrarFavoritos?: boolean;
}) {
  const { count, ready } = useCart();

  return (
    <div className="grid gap-4 md:grid-cols-2">
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
    </div>
  );
}
