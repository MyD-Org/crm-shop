import { getCatalogo } from "@/lib/catalog";
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

  return <CatalogoClient productos={productos} query={q} />;
}
