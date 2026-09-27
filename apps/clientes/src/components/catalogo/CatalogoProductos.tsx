"use client";

import Image from "next/image";
import { Badge, ProductCard, cn } from "@myd-org/ui";
import { AddToCartButton } from "@/components/AddToCartButton";
import { BotonFavorito } from "@/components/BotonFavorito";
import { CuotasCard } from "@/components/CuotasCard";
import type { Product } from "@/data/products";
import type { VistaCatalogo } from "@/lib/catalogo-url";
import { etiquetaStock, maxCantidad } from "@/lib/catalogo-vista";
import { formatNombreProducto } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";
import type { OpcionCuotas } from "@/lib/pagos/cuotas-tipos";
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
}: {
  productos: Product[];
  vista: VistaCatalogo;
  navegando: boolean;
  cuotasPorProducto: Map<string, OpcionCuotas>;
}) {
  return (
    <div
      // 2/3/4 columnas: 24 productos por página entran justo en las tres
      // grillas, sin filas huérfanas.
      className={cn(
        "transition-opacity",
        vista === "lista"
          ? "flex flex-col gap-3"
          : "grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4",
        navegando && "opacity-50"
      )}
      aria-busy={navegando}
    >
      {productos.map((p) => {
        // Sólo para mostrar: `p.name` (buscar, ordenar, carrito) no se toca.
        const nombreParaMostrar = formatNombreProducto(p.name, p.brand ? formatMarca(p.brand) : undefined);
        return (
        <ProductCard
          key={p.id}
          variant="editorial"
          layout={vista === "lista" ? "list" : "grid"}
          className="h-full"
          href={`/producto/${p.id}`}
          renderLink={linkNext}
          brand={p.brand}
          name={nombreParaMostrar}
          code={p.sku}
          stock={p.stock}
          stockLabel={etiquetaStock(p)}
          // Final con IVA si se conoce; si no, el de siempre.
          price={p.precioFinal ?? p.price}
          oldPrice={p.oldPrice}
          badge={p.badgeText ? <Badge tone={p.badgeTone}>{p.badgeText}</Badge> : undefined}
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
              : [<LightbulbIcon key="sin-foto" className="h-20 w-20 text-muted/30" />]
          }
          // Siempre presente, aunque no haya cuotas: reserva la línea para que
          // el precio no baile entre cards de la misma fila.
          installments={
            <span className="block min-h-4.5">
              <CuotasCard opcion={cuotasPorProducto.get(p.id) ?? null} />
            </span>
          }
          // Siempre abajo: el "+" se vuelve stepper al agregar, y al costado
          // unas cards lo dejaban junto al precio y otras abajo según su largo.
          actionPlacement="below"
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
