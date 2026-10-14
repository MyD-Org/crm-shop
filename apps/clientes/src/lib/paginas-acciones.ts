"use server";

import { updateTag } from "next/cache";
import { esAdmin } from "@/lib/auth";
import { TAG_HOME } from "@/lib/cache-tags";
import { getDatosFooter, getDatosLegales } from "@/lib/home-datos";
import { borrarSeccionHome, guardarSeccionHome, leerSeccionesHome } from "@/lib/home-guardar";
import { base } from "@/lib/institucional/base";
import {
  PAGINAS_INSTITUCIONALES,
  claveDePagina,
  esSlugInstitucional,
  paginaDe,
  sanearPagina,
  validarPagina,
  type BloqueEditable,
  type SlugInstitucional,
} from "@/lib/institucional/paginas";
import { getMarca } from "@/lib/marca";

/**
 * Server actions del editor de páginas institucionales (`/editar-paginas`).
 * Solo admins. Escriben únicamente filas `pagina:<slug>` del tenant del
 * proyecto (`guardarSeccionHome` acota por `shopTenantId()`); el slug se valida
 * contra la lista cerrada, así no se puede apuntar a otra fila de `home_content`.
 * Nunca lanzan hacia quien las llama.
 */

export type ResultadoPagina =
  | { ok: true; updatedAt: string | null }
  | { ok: false; errores: string[] };

export type PaginaParaEditor = {
  slug: SlugInstitucional;
  titulo: string;
  publicada: boolean;
  /** `true` si tiene bloques propios; `false` = se muestra el texto base. */
  personalizada: boolean;
  /** Los bloques propios o, si no hay, el texto base (punto de partida del editor). */
  bloques: BloqueEditable[];
};

export type ResultadoLeerPaginas = { ok: true; paginas: PaginaParaEditor[] } | { ok: false; error: string };

const SIN_PERMISO = "No tiene permiso para editar las páginas.";
const PAGINA_DESCONOCIDA = "La página indicada no existe.";
const ERROR_GUARDAR = "No pudimos guardar los cambios. Inténtelo nuevamente.";
const ERROR_LEER = "No pudimos cargar las páginas. Inténtelo nuevamente.";

export async function guardarPaginaInstitucional(slug: string, payload: unknown): Promise<ResultadoPagina> {
  if (!(await esAdmin())) return { ok: false, errores: [SIN_PERMISO] };
  if (!esSlugInstitucional(slug)) return { ok: false, errores: [PAGINA_DESCONOCIDA] };
  const errores = validarPagina(payload);
  if (errores.length > 0) return { ok: false, errores };
  try {
    const { updatedAt } = await guardarSeccionHome(claveDePagina(slug), sanearPagina(payload));
    updateTag(TAG_HOME);
    return { ok: true, updatedAt: updatedAt?.toISOString() ?? null };
  } catch (err) {
    console.error(`[paginas-acciones] no se pudo guardar ${slug}:`, err);
    return { ok: false, errores: [ERROR_GUARDAR] };
  }
}

/**
 * Vuelve al texto base. Si la página estaba publicada sigue publicada (solo se
 * quitan los bloques propios); si no, se borra la fila.
 */
export async function restablecerPaginaInstitucional(slug: string): Promise<ResultadoPagina> {
  if (!(await esAdmin())) return { ok: false, errores: [SIN_PERMISO] };
  if (!esSlugInstitucional(slug)) return { ok: false, errores: [PAGINA_DESCONOCIDA] };
  const key = claveDePagina(slug);
  try {
    const actual = sanearPagina((await leerSeccionesHome([key])).get(key));
    if (actual.publicada) {
      const { updatedAt } = await guardarSeccionHome(key, { publicada: true });
      updateTag(TAG_HOME);
      return { ok: true, updatedAt: updatedAt?.toISOString() ?? null };
    }
    await borrarSeccionHome(key);
    updateTag(TAG_HOME);
    return { ok: true, updatedAt: null };
  } catch (err) {
    console.error(`[paginas-acciones] no se pudo restablecer ${slug}:`, err);
    return { ok: false, errores: [ERROR_GUARDAR] };
  }
}

/** Estado actual de las 5 páginas, sin caché, para el editor. */
export async function leerPaginasParaEditor(): Promise<ResultadoLeerPaginas> {
  if (!(await esAdmin())) return { ok: false, error: SIN_PERMISO };
  try {
    const [filas, marca, legales, footer] = await Promise.all([
      leerSeccionesHome(PAGINAS_INSTITUCIONALES.map((p) => p.key)),
      getMarca(),
      getDatosLegales(),
      getDatosFooter(),
    ]);
    const paginas = PAGINAS_INSTITUCIONALES.map(({ slug, key }) => {
      const p = sanearPagina(filas.get(key));
      return {
        slug,
        titulo: paginaDe(slug).titulo,
        publicada: p.publicada,
        personalizada: Boolean(p.bloques?.length),
        bloques: p.bloques?.length ? p.bloques : base(slug, marca, legales, footer.whatsapp).map(({ titulo, parrafos }) => ({ titulo, parrafos })),
      };
    });
    return { ok: true, paginas };
  } catch (err) {
    console.error("[paginas-acciones] no se pudieron leer las páginas:", err);
    return { ok: false, error: ERROR_LEER };
  }
}
