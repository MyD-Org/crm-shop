"use client";

import { useMemo, useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Pagination } from "@myd-org/ui";
import { CatalogoChips } from "@/components/catalogo/CatalogoChips";
import { CatalogoControles } from "@/components/catalogo/CatalogoControles";
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
 * UI del catálogo: encabezado, filtros, productos y paginación, todo
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

  // Estado optimista: el filtro que toca el visitante se marca en el acto,
  // sin esperar a que el servidor responda con la URL nueva (si no, el tilde
  // aparece recién junto con los resultados y parece que el clic no anduvo).
  // Al terminar la navegación, `estado` ya es el nuevo y el optimista se
  // descarta solo. Clics seguidos se acumulan porque parten de `estadoVisible`.
  const [estadoVisible, marcar] = useOptimistic(
    estado,
    (actual: EstadoCatalogo, cambios: Partial<EstadoCatalogo>) => ({
      ...actual,
      pagina: cambios.pagina ?? 1,
      ...cambios,
    }),
  );

  const navegar = (href: string) => startTransition(() => router.push(href));
  const ir = (cambios: Partial<EstadoCatalogo>) =>
    startTransition(() => {
      marcar(cambios);
      router.push(hrefCon(estadoVisible, cambios));
    });

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
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 py-8">
      {/* Encabezado a todo el ancho, por encima de las dos columnas. Vista y
          orden van en la línea del título —y en mobile, con ellos, el botón
          que abre la hoja— para que abajo el panel y la grilla arranquen a la
          misma altura. */}
      <CatalogoEncabezado
        estado={estado}
        acciones={
          <div className="flex items-center gap-3 max-lg:w-full max-lg:justify-between">
            <div className="lg:hidden">
              <CatalogoFiltrosSheet facetas={facetas} estado={estadoVisible} navegar={navegar} />
            </div>
            <CatalogoControles estado={estadoVisible} ir={ir} />
          </div>
        }
      />

      {/* Los filtros puestos, debajo del encabezado y sólo en mobile: en
          desktop el panel lateral ya muestra los tildes. */}
      <CatalogoChips estado={estadoVisible} rango={facetas.precio} ir={ir} />

      <div className="mt-8 flex gap-6">
        {/*
          Filtros sticky en desktop: quedan a la vista mientras se recorre la
          grilla. `self-start` evita que el aside se estire al alto de la
          grilla (sin eso no hay nada que "pegar").
          - `top-20` (80px): al bajar, el header completo se va y en su lugar
            aparece la barra compacta fija del SiteHeader (`compactOnScroll`),
            de 56px (`h-14` en el DS). El panel se pega debajo de ella con
            24px de aire; con el `top-6` de antes quedaba tapado. Si la barra
            cambia de alto en el DS, este valor tiene que acompañarla (el DS
            no expone su alto como token).
          - Si el panel es más alto que la pantalla (marcas expandidas),
            scrollea adentro: `max-h-screen` + `pb-20` compensa el `top-20`
            para que el final del panel no quede fuera de pantalla.
            Sin valores arbitrarios.
        */}
        <aside className="scroll-fino sticky top-20 hidden max-h-screen w-64 shrink-0 self-start overflow-y-auto overscroll-contain pb-20 lg:block">
          <CatalogoFiltros facetas={facetas} estado={estadoVisible} ir={ir} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
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
              vista={estadoVisible.vista}
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
      </div>
    </main>
  );
}
