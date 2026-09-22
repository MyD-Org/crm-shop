"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Pagination } from "@myd-org/ui";
import { CatalogoChips } from "@/components/catalogo/CatalogoChips";
import { CatalogoEncabezado } from "@/components/catalogo/CatalogoEncabezado";
import { CatalogoFiltros } from "@/components/catalogo/CatalogoFiltros";
import { CatalogoFiltrosSheet } from "@/components/catalogo/CatalogoFiltrosSheet";
import { CatalogoProductos } from "@/components/catalogo/CatalogoProductos";
import { linkNext } from "@/components/catalogo/link-next";
import type { Product } from "@/data/products";
import type { Facetas } from "@/lib/catalog";
import { hrefCon, type EstadoCatalogo } from "@/lib/catalogo-url";
import { anuncioResultados, hayFiltros, limpiarFiltros } from "@/lib/catalogo-vista";
import { mejorOpcionPara } from "@/lib/cuotas-exhibicion";
import type { OfertaCuotas, OpcionCuotas } from "@/lib/pagos/cuotas-tipos";

/**
 * UI del catálogo: filtros, encabezado, chips, productos y paginación, todo
 * con componentes de `@myd-org/ui` (ver src/components/catalogo/).
 *
 * El filtrado, el orden y el conteo NO pasan por acá: los resuelve Postgres
 * y llegan resueltos desde `catalogo/page.tsx`. Este componente sólo traduce
 * lo que toca el visitante a una URL nueva, porque el estado del catálogo
 * vive en la query string (ver src/lib/catalogo-url.ts).
 */
export function CatalogoClient({
  productos,
  facetas,
  estado,
  total,
  paginas,
  oferta = null,
}: {
  /** Sólo la página actual, nunca el catálogo entero. */
  productos: Product[];
  facetas: Facetas;
  /** Filtros, orden, vista y página vigentes, tal como los leyó el servidor. */
  estado: EstadoCatalogo;
  /** Productos que cumplen los filtros, más allá de esta página. */
  total: number;
  paginas: number;
  /** Oferta de cuotas resuelta en el server. null = no se muestran cuotas. */
  oferta?: OfertaCuotas | null;
}) {
  const router = useRouter();
  // Navegar es un round-trip al servidor: mientras tanto, la grilla se atenúa
  // en vez de quedarse muda.
  const [navegando, startTransition] = useTransition();

  const navegar = (href: string) => startTransition(() => router.push(href));
  const ir = (cambios: Partial<EstadoCatalogo>) => navegar(hrefCon(estado, cambios));

  // Mejor opción de cuotas por producto, sobre su precio final unitario.
  const cuotasPorProducto = useMemo(() => {
    const m = new Map<string, OpcionCuotas>();
    if (!oferta) return m;
    for (const p of productos) {
      const mejor = mejorOpcionPara(p.precioFinal, oferta);
      if (mejor) m.set(p.id, mejor);
    }
    return m;
  }, [productos, oferta]);

  const conFiltros = hayFiltros(estado);

  return (
    <main className="mx-auto flex w-full max-w-contenido flex-1 gap-6 px-4 py-8">
      <aside className="hidden w-64 shrink-0 lg:block">
        <CatalogoFiltros facetas={facetas} estado={estado} ir={ir} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <CatalogoEncabezado estado={estado} total={total} paginas={paginas} ir={ir} />
        {/* Mobile: el aside no entra; el mismo panel va en una hoja. */}
        <div className="lg:hidden">
          <CatalogoFiltrosSheet facetas={facetas} estado={estado} navegar={navegar} />
        </div>
        <CatalogoChips estado={estado} rango={facetas.precio} ir={ir} />

        {productos.length === 0 ? (
          <EmptyState
            title="No encontramos productos con esos filtros."
            description={
              estado.query && !conFiltros
                ? "Pruebe con otra palabra o revise la ortografía."
                : "Quite alguno de los filtros e inténtelo de nuevo."
            }
            action={
              conFiltros ? (
                <Button variant="secondary" onClick={() => ir(limpiarFiltros())}>
                  Limpiar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <CatalogoProductos
            productos={productos}
            vista={estado.vista}
            navegando={navegando}
            cuotasPorProducto={cuotasPorProducto}
          />
        )}

        {/* Cada página es una URL real: se comparte, se abre en otra pestaña y se indexa. */}
        {paginas > 1 && (
          <div className="flex justify-center">
            <Pagination
              page={estado.pagina}
              totalPages={paginas}
              hrefFor={(n) => hrefCon(estado, { pagina: n })}
              renderLink={linkNext}
              labels={{ ariaLabel: "Paginación del catálogo" }}
            />
          </div>
        )}

        {/* Sólo para lectores de pantalla: el cambio de página no mueve el foco. */}
        <p className="sr-only" role="status">
          {anuncioResultados(productos.length, total, estado.pagina, paginas)}
        </p>
      </div>
    </main>
  );
}
