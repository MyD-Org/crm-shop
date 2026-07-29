import { getCatalogo, facetasDe } from "@/lib/catalog";
import { CatalogoClient } from "@/components/CatalogoClient";

// Lee el catálogo de Alegra en cada request.
export const dynamic = "force-dynamic";

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const productos = await getCatalogo({ busqueda: q, limit: 30 });
  // Filtros sobre los productos mostrados: los conteos son de esta lista.
  const facetas = facetasDe(productos);

  return (
    <CatalogoClient productos={productos} facetas={facetas} query={q} />
  );
}
