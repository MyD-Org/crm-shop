"use client";

import Link from "next/link";
import Image from "next/image";
import { ProductCard } from "@myd-org/ui";
import { AddToCartButton } from "@/components/AddToCartButton";
import { BotonFavorito } from "@/components/BotonFavorito";
import { CuotasCard } from "@/components/CuotasCard";
import { mejorOpcionPara } from "@/lib/cuotas-exhibicion";
import { etiquetaStock, mostrarStockEnCard } from "@/lib/catalogo-vista";
import { nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";
import type { Product } from "@/data/products";
import { badgeProducto } from "@/components/badge-producto";
import { conPrecioCuenta, usePreciosCuenta } from "@/hooks/usePreciosCuenta";

function LightbulbIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
    </svg>
  );
}

/**
 * Card de producto dentro de un `ProductosCarrusel` (destacados de la home y
 * "Más de…" de la ficha). La card entera es un link a la ficha.
 *
 * Prioridad de la imagen: la foto real del producto (overlay del CRM) > la
 * decorativa que pase el que llama > el ícono de siempre.
 */
export function TarjetaProductoCarrusel({
  producto,
  oferta,
  imagenDecorativa,
}: {
  producto: Product;
  oferta: OfertaCuotas | null;
  imagenDecorativa?: string;
}) {
  // Precio especial de la cuenta: todas las tarjetas se piden en una sola tanda.
  const p = conPrecioCuenta(producto, usePreciosCuenta([producto.id]).get(producto.id));
  const fotoReal = p.images?.[0];
  // Sólo para mostrar: `p.name` (carrito, orden) no se toca.
  const marca = p.brand ? formatMarca(p.brand) : undefined;
  const { nombre: nombreParaMostrar, esCodigo } = nombreConMarca(p.name, marca);
  return (
    <Link
      href={`/producto/${p.id}`}
      className="block transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 motion-reduce:hover:translate-y-0"
    >
      <ProductCard
        variant="soft"
        className="h-full overflow-hidden"
        name={nombreParaMostrar}
        brand={marca}
        stock={p.stock}
        stockLabel={etiquetaStock(p)}
        showStock={mostrarStockEnCard(p)}
        price={p.precioFinal ?? p.price}
        oldPrice={p.oldPrice}
        badge={badgeProducto(p)}
        // La card entera es un <Link>: el corazón corta la navegación.
        cornerAction={<BotonFavorito productId={p.id} dentroDeLink />}
        image={
          fotoReal ? (
            <Image
              src={fotoReal.url}
              alt={fotoReal.alt || nombreParaMostrar}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-contain p-4"
            />
          ) : imagenDecorativa ? (
            <Image
              src={imagenDecorativa}
              alt={nombreParaMostrar}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover"
            />
          ) : (
            <LightbulbIcon className="h-12 w-12 text-muted/40" />
          )
        }
        // Si el nombre ya es el código, la nota lo repetiría.
        priceNote={p.sku && !esCodigo ? `Cód. ${p.sku}` : undefined}
        action={
          <AddToCartButton
            product={{ id: p.id, name: p.name, brand: p.brand, price: p.price, image: p.images?.[0]?.url }}
          />
        }
        installments={<CuotasCard opcion={mejorOpcionPara(p.precioFinal, oferta)} />}
      />
    </Link>
  );
}
