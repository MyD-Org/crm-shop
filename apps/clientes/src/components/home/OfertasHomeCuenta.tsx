"use client";

import Link from "next/link";
import type { Product } from "@/data/products";
import { ProductosCarrusel } from "@/components/ProductosCarrusel";
import { TarjetaProductoCarrusel } from "@/components/TarjetaProductoCarrusel";
import { useOfertasCuenta } from "@/hooks/useOfertasCuenta";
import { HREF_OFERTAS } from "@/lib/catalogo-url";
import { filtrarOfertasCuenta } from "@/lib/ofertas-cuenta";

/** Textos del bloque de ofertas de la home (usted). */
export const TEXTOS_OFERTAS_HOME = {
  cinta: "Ofertas",
  titulo: "Precios especiales por tiempo limitado",
  verTodas: "Ver todas las ofertas",
} as const;

/**
 * Bloque «Precios especiales por tiempo limitado» (diseño «Ofertas más llamativas», punto 2): banda
 * en el color de la marca, cinta en el resaltado, las ofertas de mayor descuento con la misma card
 * del catálogo (borde y pestaña de campaña) y «Ver todas las ofertas». A una cuenta con lista propia
 * sólo le muestra las ofertas que le aplican; si no le aplica ninguna, el bloque no se dibuja.
 * Mismo aire arriba que la vista de la promo del editor, con la que comparte el lugar.
 */
export function OfertasHomeCuenta({ productos }: { productos: Product[] }) {
  const visibles = filtrarOfertasCuenta(productos, useOfertasCuenta());
  if (visibles.length === 0) return null;
  return (
    <div className="pt-[clamp(40px,5vw,72px)]">
      <section data-ofertas-home="" aria-labelledby="ofertas-home-titulo" className="rounded-[28px] bg-primary px-[clamp(16px,3vw,32px)] py-[clamp(20px,3vw,32px)] text-on-primary">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col items-start gap-2">
            <span className="rounded-full bg-highlight px-3 py-1 font-display text-xs font-extrabold uppercase tracking-wider text-text">
              {TEXTOS_OFERTAS_HOME.cinta}
            </span>
            <h2 id="ofertas-home-titulo" className="font-display text-2xl font-extrabold tracking-tight md:text-3xl">
              {TEXTOS_OFERTAS_HOME.titulo}
            </h2>
          </div>
          <Link
            href={HREF_OFERTAS}
            className="rounded-full bg-surface px-5 py-2.5 text-sm font-bold text-text transition-colors hover:bg-elevated"
          >
            {TEXTOS_OFERTAS_HOME.verTodas}
          </Link>
        </div>
        <ProductosCarrusel label={TEXTOS_OFERTAS_HOME.titulo} perView={4}>
          {visibles.map((p) => (
            <TarjetaProductoCarrusel key={p.id} producto={p} />
          ))}
        </ProductosCarrusel>
      </section>
    </div>
  );
}
