/**
 * SEO de las páginas de categoría del catálogo (`/catalogo?categoria=<nombre>`). Ya son indexables y tienen
 * canonical (`indexable`, `hrefCanonico`); acá se suma lo que les faltaba para que Google las trate como
 * páginas propias: el título con el nombre de la categoría y su lugar en el sitemap.
 *
 * Sólo cuentan las categorías que publican al menos un producto (mismo total fijo que el panel de filtros,
 * de la caché compartida del catálogo). Si la lectura falla, ninguna: el sitemap y la metadata siguen como
 * antes y nada se rompe.
 */
import { categoriasTotalesPublicas } from "./catalogo-publico";
import { flagsPublicos } from "./flags-publicos";
import { dispCatalogo } from "./zona-servidor";
import { hrefCanonico, leerEstado } from "./catalogo-url";

/** Nombres de las categorías con productos publicados. */
export async function categoriasIndexables(): Promise<string[]> {
  try {
    const [{ soloVisibles, variantes }, disp] = await Promise.all([flagsPublicos(), dispCatalogo()]);
    const totales = await (variantes
      ? categoriasTotalesPublicas(soloVisibles, disp, true)
      : categoriasTotalesPublicas(soloVisibles, disp));
    return [...new Set(totales.filter((c) => c.count > 0).map((c) => c.label))];
  } catch (err) {
    console.error("[catalogo-seo] no se pudieron leer las categorías:", err);
    return [];
  }
}

/** Ruta canónica de la página de una categoría (la misma que declara su `canonical`). */
export function rutaDeCategoria(nombre: string): string {
  return hrefCanonico(leerEstado({ categoria: nombre }));
}

/** Título y descripción de la página de una categoría (la plantilla del layout suma el nombre de la tienda). */
export function metadataDeCategoria(nombre: string, pagina: number): { title: string; description: string } {
  return {
    title: pagina > 1 ? `${nombre} (página ${pagina})` : nombre,
    description: `${nombre}: precios, stock y medios de pago actualizados. Compre online.`,
  };
}
