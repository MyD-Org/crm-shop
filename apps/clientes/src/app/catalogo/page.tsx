import { Suspense } from "react";
import type { Metadata } from "next";
import { getFacetas, getPaginaCatalogo } from "@/lib/catalog";
import {
  filtrosDeEstado,
  hrefCanonico,
  leerEstado,
  type EstadoCatalogo,
  type ParamCrudo,
} from "@/lib/catalogo-url";
import { indexable } from "@/lib/catalogo-vista";
import { CatalogoClient } from "@/components/CatalogoClient";
import { CatalogoSkeleton } from "@/components/catalogo/CatalogoSkeleton";
import { getOfertaCuotas } from "@/lib/cuotas-datos";

// Lee el espejo local del catálogo en cada request (lo refresca el cron diario).
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    q?: ParamCrudo;
    categoria?: ParamCrudo;
    marca?: ParamCrudo;
    orden?: ParamCrudo;
    pagina?: ParamCrudo;
    precio_min?: ParamCrudo;
    precio_max?: ParamCrudo;
    stock?: ParamCrudo;
    vista?: ParamCrudo;
  }>;
};

/**
 * SEO de las combinaciones de filtros. Indexan `/catalogo`, una categoría y
 * sus páginas; el resto queda `noindex, follow` (ver `indexable`).
 *
 * El `canonical` necesita una URL absoluta, que sale del `metadataBase` del
 * layout (`NEXT_PUBLIC_SITE_URL`). Sin esa variable se omite: un canonical
 * relativo sin base rompe el build y uno resuelto contra localhost es peor
 * que ninguno.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const estado = leerEstado(await searchParams);
  return {
    robots: { index: indexable(estado), follow: true },
    ...(process.env.NEXT_PUBLIC_SITE_URL
      ? { alternates: { canonical: hrefCanonico(estado) } }
      : {}),
  };
}

/**
 * Suspense PARCIAL (sin `loading.tsx`): en la primera carga se ve la silueta
 * del catálogo (`CatalogoSkeleton`) mientras Postgres resuelve; al filtrar,
 * no. La navegación por `searchParams` es una transición y el segmento de la
 * página conserva su identidad (Next 16.2.9, `layout-router.js`: la clave
 * del segmento se arma SIN los search params), así que React deja la grilla
 * vigente —atenuada por `CatalogoClient`— en lugar de volver al fallback.
 *
 * Plan B si alguna vez el skeleton apareciera al filtrar: sacar el
 * `Suspense` y renderizar `CatalogoResultados` directo (queda sólo el
 * atenuado; se pierde el skeleton de la primera carga).
 */
export default async function CatalogoPage({ searchParams }: Props) {
  const estado = leerEstado(await searchParams);
  return (
    <Suspense fallback={<CatalogoSkeleton estado={estado} />}>
      <CatalogoResultados estado={estado} />
    </Suspense>
  );
}

/** Las lecturas del catálogo y el render del cliente (lo que suspende). */
async function CatalogoResultados({ estado }: { estado: EstadoCatalogo }) {
  // Los mismos filtros para la página y para las facetas: `getFacetas` decide
  // qué grupo excluye en cada conteo. "Solo con stock" viene prendido por
  // defecto (ver `SOLO_STOCK_DEFAULT`).
  const filtros = filtrosDeEstado(estado);

  // Sólo viaja al browser la página pedida. Filtros, orden y conteos se
  // resuelven en Postgres: filtrar u ordenar después de paginar daría
  // resultados incompletos.
  //
  // Las tres lecturas son independientes entre sí:
  // - las facetas cruzan los grupos: las marcas se cuentan dentro de las
  //   categorías tildadas y las categorías dentro de las marcas tildadas, para
  //   que la lista no ofrezca marcas ajenas a lo que se está viendo; el rango
  //   de precio sale del conjunto filtrado sin el propio rango;
  // - la oferta de cuotas es una lectura chica; null (flag apagado, sin datos
  //   o error) ⇒ el catálogo sale sin cuotas.
  const [pagina, facetas, oferta] = await Promise.all([
    getPaginaCatalogo({ filtros, orden: estado.orden, pagina: estado.pagina }),
    getFacetas(filtros),
    getOfertaCuotas(),
  ]);

  return (
    <CatalogoClient
      productos={pagina.productos}
      total={pagina.total}
      paginas={pagina.paginas}
      // La página efectiva, no la pedida: si la URL dice 99 y hay 12, manda 12.
      estado={{ ...estado, pagina: pagina.pagina }}
      facetas={facetas}
      oferta={oferta}
    />
  );
}
