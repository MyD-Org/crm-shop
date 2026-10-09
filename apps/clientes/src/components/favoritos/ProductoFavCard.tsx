"use client";

import Image from "next/image";
import { ProductCard } from "@myd-org/ui";
import { AddToCartButton } from "@/components/AddToCartButton";
import { BotonFavorito } from "@/components/BotonFavorito";
import { CuotasCard } from "@/components/CuotasCard";
import { PrecioMedioCard } from "@/components/PrecioMedio";
import { linkNext } from "@/components/catalogo/link-next";
import type { Product } from "@/data/products";
import { badgeProducto } from "@/components/badge-producto";
import { TarjetaConsulte, TarjetaPrecioPendiente } from "@/components/TarjetasPrecioCuenta";
import { IconoLampara } from "@/components/mi-cuenta/iconos";
import { etiquetaStock, maxCantidad, mostrarStockEnCard } from "@/lib/catalogo-vista";
import { mejorCuotaProducto } from "@/lib/cuotas-sin-interes";
import { nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";

/**
 * Card compacta (`layout="list"`) de un producto en una lista de favoritos, con
 * la misma regla de precio, cuotas, stock e imagen que el catálogo. La usan Mi
 * cuenta y la lista compartida. `p` ya viene con el estado de precio de la
 * cuenta aplicado (`aplicarEstadoPrecio`).
 */
export function ProductoFavCard({ p }: { p: Product }) {
  // Sólo para mostrar: `p.name` (carrito, orden) no se toca.
  const marca = p.brand ? formatMarca(p.brand) : undefined;
  const { nombre: nombreParaMostrar, esCodigo } = nombreConMarca(p.name, marca);
  if (p.precioCuenta === "pendiente") return <TarjetaPrecioPendiente layout="list" />;
  if (p.precioCuenta === "consulte") {
    return (
      <TarjetaConsulte
        layout="list"
        href={`/producto/${p.id}`}
        nombre={nombreParaMostrar}
        marca={marca}
        imagen={
          p.images?.[0] ? (
            <Image
              src={p.images[0].url}
              alt={p.images[0].alt ?? nombreParaMostrar}
              fill
              sizes="96px"
              className="object-contain p-2"
            />
          ) : (
            <IconoLampara size={40} />
          )
        }
      />
    );
  }
  return (
    <ProductCard
      variant="soft"
      priceSize={p.precioMedio ? "sm" : "md"}
      layout="list"
      href={`/producto/${p.id}`}
      renderLink={linkNext}
      brand={marca}
      name={nombreParaMostrar}
      code={esCodigo ? undefined : p.sku}
      stock={p.stock}
      stockLabel={etiquetaStock(p)}
      showStock={mostrarStockEnCard(p)}
      // Final con IVA si se conoce; si no, el de siempre (igual que el catálogo).
      price={p.precioFinal ?? p.price}
      oldPrice={p.oldPrice}
      badge={badgeProducto(p)}
      image={
        p.images?.[0] ? (
          <Image
            src={p.images[0].url}
            alt={p.images[0].alt ?? nombreParaMostrar}
            fill
            sizes="(min-width: 640px) 160px, 128px"
            className="object-contain p-2"
          />
        ) : (
          <IconoLampara size={40} />
        )
      }
      installments={
        <>
          <PrecioMedioCard medio={p.precioMedio} />
          <CuotasCard opcion={mejorCuotaProducto(p.cuotasSinInteres)} />
        </>
      }
      cornerAction={<BotonFavorito productId={p.id} size="sm" />}
      action={
        <AddToCartButton
          disabled={p.stock === "out"}
          max={maxCantidad(p)}
          product={{ id: p.id, name: p.name, brand: p.brand, price: p.price, image: p.images?.[0]?.url }}
        />
      }
    />
  );
}
