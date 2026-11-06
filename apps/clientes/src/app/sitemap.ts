import type { MetadataRoute } from "next";
import { idsProductosPublicos } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { getPaginasPublicadas } from "@/lib/institucional/datos";
import { getPaginasMarcaPublicadas } from "@/lib/marcas/marcas-datos";
import { rutasSitemapMarcas } from "@/lib/marcas/vista-marca";
import { baseDelSitio, entradasSitemap } from "@/lib/seo";
import { esSitioSecundarioDelEntorno, urlCanonicaDelSitio } from "@/lib/sitio-url";

/**
 * Páginas públicas + una ficha por producto publicado (mismo criterio que el
 * catálogo: activo, con precio y, con el flag `catalogo-solo-visibles`, sólo
 * lo curado). Los ids salen de la caché del catálogo (tag `catalogo`).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Un sitemap no puede listar URLs de otro host: el secundario sale vacío.
  if (esSitioSecundarioDelEntorno()) return [];
  const sitio = urlCanonicaDelSitio();
  if (!baseDelSitio(sitio)) return [];
  const { soloVisibles, variantes } = await flagsPublicos();
  const [ids, paginas, marcas] = await Promise.all([
    variantes ? idsProductosPublicos(soloVisibles, true) : idsProductosPublicos(soloVisibles),
    getPaginasPublicadas(),
    getPaginasMarcaPublicadas(),
  ]);
  return entradasSitemap(sitio, ids, [...paginas.map((p) => p.href), ...rutasSitemapMarcas(marcas)]);
}
