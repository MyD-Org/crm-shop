"use client";

import { EmptyState } from "@myd-org/ui";
import { BotonCompartirLista } from "@/components/BotonCompartirLista";
import { ProductoFavCard } from "@/components/favoritos/ProductoFavCard";
import { useFavoritos } from "@/context/FavoritosContext";
import type { Product } from "@/data/products";
import { usePreciosCuenta } from "@/hooks/usePreciosCuenta";
import { MENSAJE_FAVORITOS } from "@/lib/carrito-compartido";
import { visiblesEnLista } from "@/lib/favoritos-cliente";
import { hrefFavoritosCompartidos } from "@/lib/favoritos-compartidos";
import { aplicarEstadoPrecio } from "@/lib/precios-cuenta-estado";
import { BotonEnlace } from "./BotonEnlace";

/**
 * Favoritos en cards compactas (`layout="list"`), con la misma regla de precio,
 * cuotas, stock e imagen que el catálogo. Quitar un favorito oculta su card al
 * instante; si la API no guarda, vuelve (el provider revierte). Si no queda
 * ninguno, el estado vacío. Arriba, "Compartir favoritos" con los ids de las
 * cards que se ven.
 */
export function FavoritosLista({ productos }: { productos: Product[] }) {
  const { ready, esFavorito } = useFavoritos();
  const preciosCuenta = usePreciosCuenta(productos.map((p) => p.id));
  const visibles = visiblesEnLista(productos, ready, esFavorito).map((p) =>
    aplicarEstadoPrecio(p, preciosCuenta.get(p.id)),
  );

  // Quitó el último desde esta misma página.
  if (visibles.length === 0) {
    return (
      <EmptyState
        title="Todavía no guardó favoritos."
        action={<BotonEnlace href="/catalogo">Ir al catálogo</BotonEnlace>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <BotonCompartirLista
          href={hrefFavoritosCompartidos(visibles.map((p) => p.id))}
          label="Compartir favoritos"
          mensaje={MENSAJE_FAVORITOS}
          toast={{
            title: "Enlace copiado",
            description: "Ya puede pegarlo donde quiera compartir su lista de favoritos.",
          }}
        />
      </div>
      {visibles.map((p) => (
        <ProductoFavCard key={p.id} p={p} />
      ))}
    </div>
  );
}
