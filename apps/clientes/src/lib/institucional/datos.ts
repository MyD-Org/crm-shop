import { cacheLife, cacheTag } from "next/cache";
import { getDatosFooter, getDatosLegales } from "@/lib/home-datos";
import { leerSeccionesHome } from "@/lib/home-guardar";
import { getMarca } from "@/lib/marca";
import { TAG_HOME } from "@/lib/cache-tags";
import type { Bloque } from "@/lib/legales/comun";
import { base } from "./base";
import {
  PAGINAS_INSTITUCIONALES,
  esSlugInstitucional,
  paginaDe,
  sanearPagina,
  type PayloadPagina,
  type SlugInstitucional,
} from "./paginas";

/**
 * Las 5 filas `pagina:<slug>` del tenant en UNA consulta (acotada por
 * `shopTenantId()` en `leerSeccionesHome`). Cacheada con el tag de la home: el
 * editor la invalida con el mismo `updateTag(TAG_HOME)`. Si la base falla,
 * `null` con perfil `degradado`: ninguna página se publica hasta que vuelva
 * (404 y sin enlaces), nunca por días.
 */
async function filasPaginas(): Promise<Partial<Record<SlugInstitucional, PayloadPagina>> | null> {
  "use cache";
  cacheTag(TAG_HOME);
  console.info("[cache] paginas institucionales miss");
  try {
    const filas = await leerSeccionesHome(PAGINAS_INSTITUCIONALES.map((p) => p.key));
    cacheLife("home");
    const salida: Partial<Record<SlugInstitucional, PayloadPagina>> = {};
    for (const p of PAGINAS_INSTITUCIONALES) {
      if (filas.has(p.key)) salida[p.slug] = sanearPagina(filas.get(p.key));
    }
    return salida;
  } catch (err) {
    console.error("[institucional] home_content no disponible:", err);
    cacheLife("degradado");
    return null;
  }
}

/** Contenido a mostrar de una página, o `null` si no está publicada (la ruta responde 404). */
export async function getPaginaInstitucional(
  slug: string,
): Promise<{ slug: SlugInstitucional; titulo: string; bloques: Bloque[] } | null> {
  if (!esSlugInstitucional(slug)) return null;
  const pagina = (await filasPaginas())?.[slug];
  if (!pagina?.publicada) return null;
  const { titulo } = paginaDe(slug);
  if (pagina.bloques?.length) return { slug, titulo, bloques: pagina.bloques };
  const [marca, legales, footer] = await Promise.all([getMarca(), getDatosLegales(), getDatosFooter()]);
  return { slug, titulo, bloques: base(slug, marca, legales, footer.whatsapp) };
}

/** Páginas publicadas, para el bloque "Información" del footer y el sitemap. */
export async function getPaginasPublicadas(): Promise<{ label: string; href: string }[]> {
  const filas = await filasPaginas();
  if (!filas) return [];
  return PAGINAS_INSTITUCIONALES.filter((p) => filas[p.slug]?.publicada).map((p) => ({
    label: p.titulo,
    href: `/${p.slug}`,
  }));
}
