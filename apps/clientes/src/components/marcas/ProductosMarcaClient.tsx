"use client";

import Link from "next/link";
import { useOptimistic, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FadeScroll, Pagination, cn } from "@myd-org/ui";
import { CatalogoChips } from "@/components/catalogo/CatalogoChips";
import { CatalogoControles } from "@/components/catalogo/CatalogoControles";
import { CatalogoFiltros } from "@/components/catalogo/CatalogoFiltros";
import { CatalogoFiltrosSheet } from "@/components/catalogo/CatalogoFiltrosSheet";
import { linkNext } from "@/components/catalogo/link-next";
import type { Product } from "@/data/products";
import type { Facetas } from "@/lib/catalog";
import { estadoConCambios, type EstadoCatalogo } from "@/lib/catalogo-url";
import type { LineaMarca } from "@/lib/marcas/pagina-marca";
import { hrefMarcaConEstado, hrefMarcaDesdeCatalogo } from "@/lib/marcas/estado-marca";
import { GrillaProductosMarca } from "./GrillaProductosMarca";

/**
 * "Todos los productos" de una página de marca con el panel de filtros del catálogo (categoría,
 * precio, características, stock, orden y vista): las mismas piezas que `/catalogo`, pero cada
 * cambio navega dentro de `/marcas/<slug>` (ver `estado-marca.ts`). Sin filtro de marca (lo fija
 * la página) ni búsqueda. La hoja de filtros de mobile arma hrefs de `/catalogo`: se traducen.
 */
export function ProductosMarcaClient({
  slug,
  linea,
  lineas,
  productos,
  facetas,
  estado,
  paginas,
}: {
  slug: string;
  linea?: string;
  lineas: LineaMarca[];
  productos: Product[];
  facetas: Facetas;
  estado: EstadoCatalogo;
  paginas: number;
}) {
  const router = useRouter();
  const [navegando, startTransition] = useTransition();
  const [estadoVisible, marcar] = useOptimistic(estado, estadoConCambios);
  // Dos cambios seguidos antes de un render se acumulan (mismo motivo que en CatalogoClient).
  const estadoRef = useRef(estadoVisible);
  useEffect(() => {
    estadoRef.current = estadoVisible;
  }, [estadoVisible]);

  const ir = (cambios: Partial<EstadoCatalogo>) =>
    startTransition(() => {
      const siguiente = estadoConCambios(estadoRef.current, cambios);
      estadoRef.current = siguiente;
      marcar(cambios);
      router.push(hrefMarcaConEstado(slug, siguiente, linea), { scroll: false });
    });
  const navegar = (hrefCatalogo: string) =>
    startTransition(() => router.push(hrefMarcaDesdeCatalogo(slug, hrefCatalogo, linea), { scroll: false }));

  return (
    <div className="flex flex-col gap-6">
      {lineas.length > 0 ? (
        <nav aria-label="Líneas" className="flex flex-wrap gap-2">
          {[{ slug: undefined, titulo: "Todas" }, ...lineas].map((l) => {
            const activa = linea === l.slug;
            return (
              <Link
                key={l.slug ?? "todas"}
                href={hrefMarcaConEstado(slug, { ...estadoVisible, pagina: 1 }, l.slug)}
                scroll={false}
                aria-current={activa ? "true" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  activa ? "border-text bg-text text-bg" : "border-border text-text hover:border-text",
                )}
              >
                {l.titulo}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <div className="flex items-center justify-between gap-3 lg:justify-end">
        <div className="lg:hidden">
          <CatalogoFiltrosSheet facetas={facetas} estado={estadoVisible} navegar={navegar} navegando={navegando} sinMarcas />
        </div>
        <CatalogoControles estado={estadoVisible} ir={ir} />
      </div>

      <CatalogoChips estado={estadoVisible} rango={facetas.precio} ir={ir} />

      <div className="flex gap-6">
        <FadeScroll
          as="aside"
          fadeFrom="lg"
          className="sticky top-20 hidden max-h-[calc(100dvh-5rem)] w-64 shrink-0 self-start overflow-y-auto overscroll-contain pb-12 lg:block"
        >
          <CatalogoFiltros facetas={facetas} estado={estadoVisible} ir={ir} sinMarcas />
        </FadeScroll>
        <div className={cn("flex min-w-0 flex-1 flex-col gap-6 transition-opacity", navegando && "opacity-50")}>
          {productos.length > 0 ? (
            <GrillaProductosMarca productos={productos} vista={estadoVisible.vista} />
          ) : (
            <p className="py-10 text-center text-base text-muted">No hay productos con estos filtros.</p>
          )}
          {paginas > 1 ? (
            <Pagination
              page={estado.pagina}
              totalPages={paginas}
              hrefFor={(n) => `${hrefMarcaConEstado(slug, { ...estado, pagina: n }, linea)}#productos`}
              renderLink={linkNext}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
