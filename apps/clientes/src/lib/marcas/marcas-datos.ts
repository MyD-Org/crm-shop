import { cacheLife, cacheTag } from "next/cache";
import { TAG_HOME } from "@/lib/cache-tags";
import { leerSeccionesHomePorPrefijo } from "@/lib/home-guardar";
import { claveDeMarca, ordenarPaginas, PREFIJO_CLAVE_MARCA, sanearPaginaMarca, type PaginaMarca } from "./pagina-marca";

/**
 * Todas las páginas de marca del tenant (publicadas o no), saneadas y
 * ordenadas, en UNA consulta (`leerSeccionesHomePorPrefijo` acota por
 * `shopTenantId()`). Cacheada con el tag de la home: el editor invalida con
 * `updateTag(TAG_HOME)`, como las institucionales. Si la base falla, `[]` con
 * perfil `degradado`: ninguna página se publica hasta que vuelva (404 y sin
 * enlaces), nunca por días.
 *
 * Una fila cuya clave no coincide con su `slug` se descarta: la clave es la
 * única garantía de unicidad.
 */
export async function getPaginasMarca(): Promise<PaginaMarca[]> {
  "use cache";
  cacheTag(TAG_HOME);
  console.info("[cache] paginas de marca miss");
  try {
    const filas = await leerSeccionesHomePorPrefijo(PREFIJO_CLAVE_MARCA);
    cacheLife("home");
    const paginas: PaginaMarca[] = [];
    for (const [clave, payload] of filas) {
      const p = sanearPaginaMarca(payload);
      if (p && claveDeMarca(p.slug) === clave) paginas.push(p);
    }
    return ordenarPaginas(paginas);
  } catch (err) {
    console.error("[marcas] home_content no disponible:", err);
    cacheLife("degradado");
    return [];
  }
}

/** Las publicadas, en orden (menú, `/marcas`, sitemap, home). */
export async function getPaginasMarcaPublicadas(): Promise<PaginaMarca[]> {
  return (await getPaginasMarca()).filter((p) => p.publicada);
}

/** Una página por slug (publicada o no: quien llama decide quién puede verla). */
export async function getPaginaMarca(slug: string): Promise<PaginaMarca | null> {
  return (await getPaginasMarca()).find((p) => p.slug === slug) ?? null;
}
