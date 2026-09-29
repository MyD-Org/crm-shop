"use client";

import { useEffect, useMemo, useOptimistic, useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, EmptyState, Pagination } from "@myd-org/ui";
import { CatalogoChips } from "@/components/catalogo/CatalogoChips";
import { CatalogoControles } from "@/components/catalogo/CatalogoControles";
import { CatalogoEncabezado } from "@/components/catalogo/CatalogoEncabezado";
import { CatalogoFiltros } from "@/components/catalogo/CatalogoFiltros";
import { CatalogoFiltrosSheet } from "@/components/catalogo/CatalogoFiltrosSheet";
import { CatalogoProductos } from "@/components/catalogo/CatalogoProductos";
import { linkNext } from "@/components/catalogo/link-next";
import type { Product } from "@/data/products";
import { conPrecioCuenta, usePreciosCuenta } from "@/hooks/usePreciosCuenta";
import type { Facetas } from "@/lib/catalog";
import {
  estadoConCambios,
  estadoDeBusqueda,
  filtrosDesfasados,
  hrefCatalogo,
  hrefCon,
  type EstadoCatalogo,
} from "@/lib/catalogo-url";
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
  filtrosSinBusqueda = false,
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
  /**
   * La búsqueda no encontró nada y `facetas` son las del catálogo sin ella
   * (ver catalogo/page.tsx): tocar un filtro también quita la búsqueda.
   */
  filtrosSinBusqueda?: boolean;
}) {
  const router = useRouter();
  // Navegar es un round-trip al servidor: mientras tanto, la grilla se atenúa
  // en vez de quedarse muda.
  const [navegando, startTransition] = useTransition();

  // Al destildar una marca o categoría que no es la última de la URL, Next
  // cambia la URL pero reusa la página vieja sin pedirla (ver
  // `filtrosDesfasados`): el tilde volvía a aparecer y el filtro no se iba.
  // Si la URL del router y lo que renderizó el servidor no coinciden, se
  // muestra lo que dice la URL y se pide la página de nuevo.
  const searchParams = useSearchParams();
  const desfasado = filtrosDesfasados(estado, searchParams);
  const claveUrl = searchParams.toString();
  useEffect(() => {
    if (desfasado) startTransition(() => router.refresh());
  }, [desfasado, claveUrl, router]);
  const estadoBase = desfasado ? estadoDeBusqueda(searchParams) : estado;

  // Estado optimista: el filtro que toca el visitante se marca en el acto,
  // sin esperar a que el servidor responda con la URL nueva (si no, el tilde
  // aparece recién junto con los resultados y parece que el clic no anduvo).
  // Al terminar la navegación, `estado` ya es el nuevo y el optimista se
  // descarta solo. Clics seguidos se acumulan porque parten de `estadoVisible`.
  const [estadoVisible, marcar] = useOptimistic(estadoBase, estadoConCambios);

  // `ir` puede llamarse dos veces seguidas antes de que React vuelva a
  // renderizar (dos clics rápidos, o un commit del slider seguido de un
  // toggle): si la URL de la segunda se armara con el `estadoVisible` de acá
  // arriba (el del último render), pisaría el cambio de la primera en vez de
  // acumularse, y el filtro quedaba aplicado "a veces sí, a veces no". Por
  // eso la base para el href es esta ref, que se actualiza en cada llamada
  // aunque todavía no haya habido un render de por medio (la hoja de mobile
  // no tiene este problema porque su borrador vive en un `useState` con
  // updater funcional, ver CatalogoFiltrosSheet).
  const estadoVisibleRef = useRef(estadoVisible);
  useEffect(() => {
    estadoVisibleRef.current = estadoVisible;
  }, [estadoVisible]);

  const navegar = (href: string) => startTransition(() => router.push(href));
  const ir = (cambios: Partial<EstadoCatalogo>) =>
    startTransition(() => {
      const siguiente = estadoConCambios(estadoVisibleRef.current, cambios);
      estadoVisibleRef.current = siguiente;
      marcar(cambios);
      router.push(hrefCatalogo(siguiente));
    });

  // Precio especial de la cuenta, si el cliente tiene lista propia más barata.
  const preciosCuenta = usePreciosCuenta(productos.map((p) => p.id));
  const productosCuenta = useMemo(
    () => productos.map((p) => conPrecioCuenta(p, preciosCuenta.get(p.id))),
    [productos, preciosCuenta],
  );

  // Mejor opción de cuotas por producto, sobre su precio final unitario.
  const cuotasPorProducto = useMemo(() => {
    const m = new Map<string, OpcionCuotas>();
    if (!oferta) return m;
    for (const p of productosCuenta) {
      const mejor = mejorOpcionPara(p.precioFinal, oferta);
      if (mejor) m.set(p.id, mejor);
    }
    return m;
  }, [productosCuenta, oferta]);

  const conFiltros = hayFiltros(estado);

  // Con los filtros de todo el catálogo (búsqueda sin resultados), filtrar
  // sin sacar la búsqueda volvería a dar 0: el panel la quita al tocarlo.
  const irFiltros = filtrosSinBusqueda
    ? (cambios: Partial<EstadoCatalogo>) => ir({ ...cambios, query: undefined })
    : ir;
  const estadoFiltros = filtrosSinBusqueda ? { ...estadoVisible, query: undefined } : estadoVisible;

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
              <CatalogoFiltrosSheet facetas={facetas} estado={estadoFiltros} navegar={navegar} />
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
          <CatalogoFiltros facetas={facetas} estado={estadoFiltros} ir={irFiltros} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {productos.length === 0 ? (
            // Sin culpar al visitante ("revise la ortografía"): se dice qué
            // pasó y se ofrece por dónde seguir.
            estado.query ? (
              <EmptyState
                title={`No hay resultados para "${estado.query}"`}
                description="Puede buscar con otras palabras o elegir una categoría de la lista."
                action={
                  <Button variant="secondary" onClick={() => ir({ ...limpiarFiltros(), query: undefined })}>
                    Ver todos los productos
                  </Button>
                }
              />
            ) : (
              <EmptyState
                title="No hay productos con estos filtros"
                description="Quite alguno para ver más opciones."
                action={
                  conFiltros ? (
                    <Button variant="secondary" onClick={() => ir(limpiarFiltros())}>
                      Limpiar filtros
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <CatalogoProductos
              productos={productosCuenta}
              vista={estadoVisible.vista}
              navegando={navegando || desfasado}
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
