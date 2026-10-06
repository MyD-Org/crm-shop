/**
 * Flag de las facetas por tipo de producto del catálogo (change `catalogo-filtros-ux`). Se lee sólo en
 * el server, por request, y nunca dentro de `use cache`: viaja como argumento (parte de la clave de la caché).
 *
 * Apagado (default): el panel de filtros es el de siempre y `?car=` en la URL se ignora.
 * Prendido: el panel ofrece las características que importan para la categoría o búsqueda (registro de
 * claves en `catalogo-facetas-registro.ts`) con filtro estricto `?car=` (`catalogo-car.ts`). Además hace
 * falta que `catalog_atributos` sea legible; si no, el panel degrada al de siempre.
 *
 * Vive en Vercel Flags (key `catalogo-facetas-por-tipo`, ver src/flags.ts): se cambia sin redeploy. Si no
 * se puede evaluar, se asume apagado.
 */
import { catalogoFacetasPorTipoFlag } from "@/flags";

export async function catalogoFacetasPorTipoHabilitada(): Promise<boolean> {
  try {
    return (await catalogoFacetasPorTipoFlag()) === true;
  } catch {
    return false;
  }
}
