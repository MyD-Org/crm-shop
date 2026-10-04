"use client";

import Image from "next/image";
import { ProductCard, cn } from "@myd-org/ui";
import { AddToCartButton } from "@/components/AddToCartButton";
import { BotonFavorito } from "@/components/BotonFavorito";
import { CuotasCard } from "@/components/CuotasCard";
import { PrecioMedioCard } from "@/components/PrecioMedio";
import type { Product } from "@/data/products";
import type { VistaCatalogo } from "@/lib/catalogo-url";
import { etiquetaStock, maxCantidad, mostrarStockEnCard } from "@/lib/catalogo-vista";
import { nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";
import type { OpcionCuotas } from "@/lib/pagos/cuotas-tipos";
import { badgeProducto } from "@/components/badge-producto";
import { LightbulbIcon } from "./iconos";
import { linkNext } from "./link-next";

/**
 * Grilla o lista de productos. Cada card es UN enlace a la ficha (patrón
 * stretched link del DS): el botón de agregar queda fuera del `<a>`.
 *
 * Mientras el server arma la página siguiente (`navegando`), la vigente se
 * atenúa y queda `aria-busy`.
 */
export function CatalogoProductos({
  productos,
  vista,
  navegando,
  cuotasPorProducto,
  alElegir,
}: {
  productos: Product[];
  vista: VistaCatalogo;
  navegando: boolean;
  cuotasPorProducto: Map<string, OpcionCuotas>;
  /** Se llama con el índice (en esta página) del producto cuyo enlace se tocó (telemetría de la búsqueda). */
  alElegir?: (indice: number) => void;
}) {
  // La línea de cuotas se reserva sólo si algún producto de la página tiene
  // cuotas: así el precio no baila entre cards de una fila, y sin cuotas en
  // ninguno las cards no cargan una línea vacía.
  const reservarCuotas = productos.some((p) => cuotasPorProducto.has(p.id));
  // Igual con "$X con <Medio>": se reserva sólo si algún producto de la página lo muestra.
  const reservarMedio = productos.some((p) => p.precioMedio);
  return (
    <div
      // 2/3/4 columnas: 24 productos por página entran justo en las tres
      // grillas, sin filas huérfanas. En mobile el gap es chico (8 px): con
      // dos columnas de ~170 px, cada px de gap se lo come el ancho de la card.
      className={cn(
        "transition-opacity",
        vista === "lista"
          ? "flex flex-col gap-2 sm:gap-3"
          : "grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-3 md:gap-5 xl:grid-cols-4",
        navegando && "opacity-50"
      )}
      aria-busy={navegando}
      // Delegado: la card del DS no expone su clic; se lee el enlace a la ficha que se tocó.
      onClickCapture={
        alElegir
          ? (e) => {
              const enlace = (e.target as HTMLElement).closest("a[href^='/producto/']");
              const id = enlace?.getAttribute("href")?.slice("/producto/".length).split(/[?#]/)[0];
              const indice = id ? productos.findIndex((p) => p.id === decodeURIComponent(id)) : -1;
              if (indice >= 0) alElegir(indice);
            }
          : undefined
      }
    >
      {productos.map((p) => {
        // Sólo para mostrar: `p.name` (buscar, ordenar, carrito) no se toca.
        const marca = p.brand ? formatMarca(p.brand) : undefined;
        const { nombre: nombreParaMostrar, esCodigo } = nombreConMarca(p.name, marca);
        return (
        <ProductCard
          key={p.id}
          variant="soft"
          layout={vista === "lista" ? "list" : "grid"}
          className="h-full"
          href={`/producto/${p.id}`}
          renderLink={linkNext}
          brand={marca}
          name={nombreParaMostrar}
          // Si el nombre ya es el código, la línea "Cód." lo repetiría.
          code={esCodigo ? undefined : p.sku}
          stock={p.stock}
          stockLabel={etiquetaStock(p)}
          showStock={mostrarStockEnCard(p)}
          // Final con IVA si se conoce; si no, el de siempre.
          price={p.precioFinal ?? p.price}
          oldPrice={p.oldPrice}
          badge={badgeProducto(p)}
          // El slot queda fuera del enlace estirado de la card: no navega.
          cornerAction={<BotonFavorito productId={p.id} />}
          // Fotos del overlay del CRM servibles (host en SHOP_MEDIA_HOSTS);
          // si no hay ninguna, el placeholder. Con más de una, la card arma la
          // galería y monta de la 2.ª en adelante recién al acercarse.
          images={
            p.images?.length
              ? p.images.map((f, i) => (
                  <Image
                    key={f.url}
                    src={f.url}
                    alt={i === 0 ? (f.alt ?? nombreParaMostrar) : (f.alt ?? "")}
                    fill
                    sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw"
                    className="object-contain p-4"
                  />
                ))
              : [<LightbulbIcon key="sin-foto" className="h-12 w-12 text-muted/40" />]
          }
          installments={
            reservarCuotas || reservarMedio ? (
              <>
                {reservarMedio && (
                  <span className="block min-h-4">
                    <PrecioMedioCard medio={p.precioMedio} />
                  </span>
                )}
                {reservarCuotas && (
                  <span className="block min-h-4.5">
                    <CuotasCard opcion={cuotasPorProducto.get(p.id) ?? null} />
                  </span>
                )}
              </>
            ) : undefined
          }
          action={
            <AddToCartButton
              disabled={p.stock === "out"}
              max={maxCantidad(p)}
              product={{ id: p.id, name: p.name, brand: p.brand, price: p.price, image: p.images?.[0]?.url }}
            />
          }
        />
        );
      })}
    </div>
  );
}
