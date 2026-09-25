"use client";

import { Breadcrumb, Card, ProductCardSkeleton, Skeleton } from "@myd-org/ui";
import { linkNext } from "./link-next";

/** Las dos primeras migas, comunes a cualquier URL del catálogo. */
const MIGAS = [
  { label: "Inicio", href: "/" },
  { label: "Catálogo", href: "/catalogo" },
];

/** Cards de relleno: la mitad de una página, alcanza para cubrir la pantalla. */
const CARDS = 12;
/** Líneas de relleno del panel de filtros. */
const LINEAS_FILTRO = 6;

/**
 * Silueta del catálogo en la PRIMERA carga (fallback del `Suspense` de
 * `catalogo/page.tsx`). Mismo `<main>`, aside y columna que `CatalogoClient`
 * para que el contenido no salte al llegar. Va en el shell estático (Cache
 * Components), igual para cualquier URL: no lee los filtros, así que el
 * título es una silueta del mismo alto y la grilla, la de siempre.
 *
 * Al filtrar no aparece: la navegación es una transición y React mantiene la
 * grilla vigente (atenuada) en vez de volver al fallback.
 *
 * Es componente cliente sólo porque el `Breadcrumb` recibe `renderLink`
 * (una función): no se puede pasar desde un Server Component.
 */
export function CatalogoSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-contenido flex-1 gap-6 px-4 py-8" aria-busy>
      <aside className="hidden w-64 shrink-0 lg:block">
        <Card title="Filtros">
          <div className="flex flex-col gap-3">
            {Array.from({ length: LINEAS_FILTRO }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </Card>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Breadcrumb items={MIGAS} renderLink={linkNext} />
          <div className="flex flex-col gap-1">
            {/* Alto de una línea del h1 (text-3xl / md:text-4xl). */}
            <Skeleton className="my-1 h-7 w-56 md:h-8" />
            <Skeleton className="h-4 w-40" />
          </div>
        </header>

        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: CARDS }, (_, i) => (
            <ProductCardSkeleton key={i} variant="editorial" layout="grid" />
          ))}
        </div>

        <p className="sr-only" role="status">
          Cargando productos…
        </p>
      </div>
    </main>
  );
}
