"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ProductCard } from "@myd-org/ui";
import { AddToCartButton, sinNavegar } from "@/components/AddToCartButton";
import { BotonAgregarOpciones } from "@/components/catalogo/AccionOpciones";
import { PanelOpciones } from "@/components/catalogo/PanelOpciones";
import { BotonFavorito } from "@/components/BotonFavorito";
import { CuotasCard } from "@/components/CuotasCard";
import { PrecioMedioCard } from "@/components/PrecioMedio";
import { mejorCuotaProducto } from "@/lib/cuotas-sin-interes";
import { etiquetaStock, mostrarStockEnCard } from "@/lib/catalogo-vista";
import { nombreConMarca } from "@/lib/formato-nombre";
import { vistaCardVariantes } from "@/lib/variantes-ficha";
import { formatMarca } from "@/lib/formato-rubro";
import type { Product } from "@/data/products";
import { badgeProducto } from "@/components/badge-producto";
import { badgeCampania, badgePromo, usePromoProducto } from "@/components/promociones/PromoProvider";
import { usePreciosCuenta } from "@/hooks/usePreciosCuenta";
import { aplicarEstadoPrecio } from "@/lib/precios-cuenta-estado";
import { TarjetaConsulte, TarjetaPrecioPendiente } from "@/components/TarjetasPrecioCuenta";

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
 * Imagen: la foto real del producto (overlay del CRM) o, si no tiene, el
 * ícono de siempre.
 */
export function TarjetaProductoCarrusel({
  producto,
  sinBadge = false,
}: {
  producto: Product;
  /** La sección de promociones dibuja su propio sello sobre la foto: la card no lleva badge. */
  sinBadge?: boolean;
}) {
  // Precio de la lista privada de la cuenta: todas las tarjetas se piden en una sola tanda.
  const p = aplicarEstadoPrecio(producto, usePreciosCuenta([producto.id]).get(producto.id));
  // Modelo con opciones: el panel para elegirla se monta fuera del `<Link>` (ver `PanelOpciones`).
  const [panelAbierto, setPanelAbierto] = useState(false);
  const promo = usePromoProducto(producto.sku);
  const fotoReal = p.images?.[0];
  // Sólo para mostrar: `p.name` (carrito, orden) no se toca.
  const marca = p.brand ? formatMarca(p.brand) : undefined;
  const { nombre: nombreParaMostrar, esCodigo } = nombreConMarca(p.name, marca);
  if (p.precioCuenta === "pendiente") return <TarjetaPrecioPendiente />;
  if (p.precioCuenta === "consulte") {
    return (
      <TarjetaConsulte
        href={`/producto/${p.id}`}
        nombre={nombreParaMostrar}
        marca={marca}
        imagen={
          fotoReal ? (
            <Image
              src={fotoReal.url}
              alt={fotoReal.alt || nombreParaMostrar}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-contain p-4"
            />
          ) : (
            <LightbulbIcon className="absolute inset-0 m-auto h-12 w-12 text-muted/40" />
          )
        }
      />
    );
  }
  // Modelo con variantes (flag `variantes-selector`): "Desde $X" si los precios difieren; el
  // botón «Agregar» abre el panel para elegir la opción.
  const vv = vistaCardVariantes(p);
  const medio = vv.esDesde ? undefined : p.precioMedio;
  return (
    <>
    <Link
      href={`/producto/${p.id}`}
      // h-full: el slide del carrusel se estira al alto de la card más alta; sin esto la card
      // (h-full) se queda en su alto propio y las de nombre corto quedan más bajas.
      className="block h-full transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 motion-reduce:hover:translate-y-0"
    >
      <ProductCard
        variant="soft"
        priceSize={medio ? "sm" : "md"}
        className="h-full overflow-hidden"
        // Gancho del estilo "estudio" de las fotos (globals.css, `[data-estudio]`).
        data-card-producto=""
        name={nombreParaMostrar}
        brand={marca}
        stock={p.stock}
        stockLabel={etiquetaStock(p)}
        showStock={mostrarStockEnCard(p)}
        price={vv.precio}
        oldPrice={vv.esDesde ? undefined : p.oldPrice}
        badge={sinBadge ? undefined : p.campania ? badgeCampania(p.campania) : (badgePromo(promo, p) ?? badgeProducto(p))}
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
          ) : (
            <LightbulbIcon className="h-12 w-12 text-muted/40" />
          )
        }
        // Si el nombre ya es el código, la nota lo repetiría.
        priceNote={vv.nota ?? (p.sku && !esCodigo ? `Cód. ${p.sku}` : undefined)}
        action={
          vv.multiple ? (
            // La card entera es un <Link>: el botón corta la navegación y abre el panel.
            <BotonAgregarOpciones
              onClick={(e) => {
                sinNavegar(e);
                setPanelAbierto(true);
              }}
            />
          ) : (
            <AddToCartButton
              product={{ id: p.id, name: p.name, brand: p.brand, price: p.price, image: p.images?.[0]?.url }}
            />
          )
        }
        installments={
          <>
            <PrecioMedioCard medio={medio} />
            <CuotasCard opcion={vv.esDesde ? null : mejorCuotaProducto(p.cuotasSinInteres)} />
          </>
        }
      />
    </Link>
    {vv.multiple && (
      <PanelOpciones producto={p} titulo={nombreParaMostrar} abierto={panelAbierto} onAbiertoChange={setPanelAbierto} />
    )}
    </>
  );
}
