import { getCatalogo, facetasDe } from "@/lib/catalog";
import { CatalogoClient } from "@/components/CatalogoClient";

// Lee el espejo local del catálogo en cada request (lo refresca el cron diario).
export const dynamic = "force-dynamic";

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  // Sin limit: el catálogo entero. Los filtros del cliente y los conteos de las
  // facetas solo son correctos si operan sobre todo el conjunto, no sobre una
  // primera página. TODO: paginar en el server cuando el payload moleste.
  const productos = await getCatalogo({ busqueda: q });
  const facetas = facetasDe(productos);

  return (
    <CatalogoClient productos={productos} facetas={facetas} query={q} />
  );
}
