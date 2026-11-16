"use client";

import { BotonCompartirLista } from "@/components/BotonCompartirLista";
import { MENSAJE_PRODUCTO } from "@/lib/carrito-compartido";

/**
 * Compartir un producto con el mismo menú que el carrito, el pedido y los
 * favoritos (WhatsApp, copiar enlace, más opciones).
 *
 * - Ficha: sin `href`, se comparte la dirección actual (incluye la opción
 *   elegida); la vista previa sale de la metadata de `producto/[id]`.
 * - Card del catálogo: `href` es la ruta de la ficha (`/producto/<id>`). El
 *   botón va en el `cornerAction` de la card, fuera del enlace estirado.
 */
export function BotonCompartir({ href, className }: { href?: string; className?: string }) {
  return (
    <BotonCompartirLista
      soloIcono
      href={href}
      className={className}
      label="Compartir producto"
      mensaje={MENSAJE_PRODUCTO}
      toast={{
        title: "Enlace copiado",
        description: "Ya puede pegarlo donde quiera compartirlo.",
      }}
    />
  );
}
