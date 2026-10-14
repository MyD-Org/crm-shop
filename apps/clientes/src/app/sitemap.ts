import type { MetadataRoute } from "next";
import { idsProductosPublicos } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { getPaginasPublicadas } from "@/lib/institucional/datos";
import { baseDelSitio, entradasSitemap } from "@/lib/seo";

/**
 * Páginas públicas + una ficha por producto publicado (mismo criterio que el
 * catálogo: activo, con precio y, con el flag `catalogo-solo-visibles`, sólo
 * lo curado). Los ids salen de la caché del catálogo (tag `catalogo`).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sitio = process.env.NEXT_PUBLIC_SITE_URL;
  if (!baseDelSitio(sitio)) return [];
  const { soloVisibles, variantes } = await flagsPublicos();
  const [ids, paginas] = await Promise.all([
    variantes ? idsProductosPublicos(soloVisibles, true) : idsProductosPublicos(soloVisibles),
    getPaginasPublicadas(),
  ]);
  return entradasSitemap(sitio, ids, paginas.map((p) => p.href));
}
