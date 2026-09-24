"use client";

import Image from "next/image";
import { EmptyState, ProductCard } from "@myd-org/ui";
import { AddToCartButton } from "@/components/AddToCartButton";
import { BotonFavorito } from "@/components/BotonFavorito";
import { CuotasCard } from "@/components/CuotasCard";
import { linkNext } from "@/components/catalogo/link-next";
import { useFavoritos } from "@/context/FavoritosContext";
import type { Product } from "@/data/products";
import { etiquetaStock, maxCantidad } from "@/lib/catalogo-vista";
import { mejorOpcionPara } from "@/lib/cuotas-exhibicion";
import { visiblesEnLista } from "@/lib/favoritos-cliente";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";
import { BotonEnlace } from "./BotonEnlace";
import { IconoLampara } from "./iconos";

/**
 * Favoritos en cards compactas (`layout="list"`), con la misma regla de precio,
 * cuotas, stock e imagen que el catálogo. Quitar un favorito oculta su card al
 * instante; si la API no guarda, vuelve (el provider revierte). Si no queda
 * ninguno, el estado vacío.
 */
export function FavoritosLista({
  productos,
  oferta,
}: {
  productos: Product[];
  /** null = sin línea de cuotas (el resumen no la consulta). */
  oferta: OfertaCuotas | null;
}) {
  const { ready, esFavorito } = useFavoritos();
  const visibles = visiblesEnLista(productos, ready, esFavorito);

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
      {visibles.map((p) => (
        <ProductCard
          key={p.id}
          variant="editorial"
          layout="list"
          href={`/producto/${p.id}`}
          renderLink={linkNext}
          brand={p.brand}
          name={p.name}
          code={p.sku}
          stock={p.stock}
          stockLabel={etiquetaStock(p)}
          // Final con IVA si se conoce; si no, el de siempre (igual que el catálogo).
          price={p.precioFinal ?? p.price}
          oldPrice={p.oldPrice}
          image={
            p.images?.[0] ? (
              <Image
                src={p.images[0].url}
                alt={p.images[0].alt ?? p.name}
                fill
                sizes="(min-width: 640px) 160px, 128px"
                className="object-contain p-2"
              />
            ) : (
              <IconoLampara size={40} />
            )
          }
          installments={<CuotasCard opcion={mejorOpcionPara(p.precioFinal, oferta)} />}
          cornerAction={<BotonFavorito productId={p.id} size="sm" />}
          action={
            <AddToCartButton
              disabled={p.stock === "out"}
              max={maxCantidad(p)}
              product={{ id: p.id, name: p.name, brand: p.brand, price: p.price }}
            />
          }
        />
      ))}
    </div>
  );
}
