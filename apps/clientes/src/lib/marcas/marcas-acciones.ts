"use server";

import { updateTag } from "next/cache";
import type { Visibilidad } from "@/data/home-defaults";
import { VISIBILIDADES } from "@/data/home-defaults";
import { esAdmin } from "@/lib/auth";
import { TAG_HOME } from "@/lib/cache-tags";
import { getValoresMarca } from "@/lib/catalog";
import { hostsDeMedios } from "@/lib/catalogo-medios";
import { flagsPublicos } from "@/lib/flags-publicos";
import {
  borrarSeccionHome,
  guardarSeccionHome,
  leerSeccionesHomePorPrefijo,
  leerSeccionHome,
} from "@/lib/home-guardar";
import {
  bloqueDelNivel,
  claveDeMarca,
  contenidoInicial,
  esBloqueMarca,
  esSlugMarca,
  ordenarPaginas,
  PREFIJO_CLAVE_MARCA,
  sanearContenidoBloque,
  sanearPaginaMarca,
  validarBloqueMarca,
  validarPaginaMarca,
  type BloqueMarca,
  type NivelMarca,
  type PaginaMarca,
} from "./pagina-marca";

/**
 * Server actions de las páginas de marca (`/editar-marcas` y la edición en el
 * lugar de `/marcas/<slug>`). Solo admins. Escriben únicamente filas
 * `pagina-marca:<slug>` del tenant (`guardarSeccionHome` acota por
 * `shopTenantId()`); el slug se valida antes de armar la clave, así no se puede
 * apuntar a otra fila de `home_content`. Leen la fila fresca (sin caché) antes
 * de escribir. Nunca lanzan hacia quien las llama.
 */

export type ResultadoMarca = { ok: true } | { ok: false; errores: string[] };

const SIN_PERMISO = "No tiene permiso para editar las marcas.";
const NO_EXISTE = "La página indicada no existe.";
const YA_EXISTE = "Ya existe una página con esa dirección.";
const BLOQUE_AJENO = "Ese bloque no corresponde a esta página.";
const ERROR_GUARDAR = "No pudimos guardar los cambios. Inténtelo nuevamente.";
const ERROR_LEER = "No pudimos cargar las páginas de marca. Inténtelo nuevamente.";

async function leerPagina(slug: string): Promise<PaginaMarca | null> {
  if (!esSlugMarca(slug)) return null;
  return sanearPaginaMarca(await leerSeccionHome(claveDeMarca(slug)));
}

async function leerTodas(): Promise<PaginaMarca[]> {
  const filas = await leerSeccionesHomePorPrefijo(PREFIJO_CLAVE_MARCA);
  const paginas: PaginaMarca[] = [];
  for (const [clave, payload] of filas) {
    const p = sanearPaginaMarca(payload);
    if (p && claveDeMarca(p.slug) === clave) paginas.push(p);
  }
  return ordenarPaginas(paginas);
}

async function escribir(p: PaginaMarca): Promise<void> {
  await guardarSeccionHome(claveDeMarca(p.slug), p);
}

/** Corre `fn` con permiso de admin y sin dejar escapar errores. */
async function comoAdmin(nombre: string, fn: () => Promise<ResultadoMarca>): Promise<ResultadoMarca> {
  if (!(await esAdmin())) return { ok: false, errores: [SIN_PERMISO] };
  try {
    return await fn();
  } catch (err) {
    console.error(`[marcas-acciones] ${nombre}:`, err);
    return { ok: false, errores: [ERROR_GUARDAR] };
  }
}

/** Lo que pasó la validación: lo saneado, o los errores. */
function comoGuardable(p: unknown): { ok: true; pagina: PaginaMarca } | { ok: false; errores: string[] } {
  const errores = validarPaginaMarca(p, hostsDeMedios());
  if (errores.length > 0) return { ok: false, errores };
  const pagina = sanearPaginaMarca(p);
  return pagina ? { ok: true, pagina } : { ok: false, errores: ["Los datos de la página no son válidos."] };
}

export async function crearPaginaMarca(datos: {
  nombre: string;
  slug: string;
  nivel: NivelMarca;
  marcasCatalogo: string[];
}): Promise<ResultadoMarca> {
  return comoAdmin("crear", async () => {
    const todas = await leerTodas();
    const nombre = typeof datos.nombre === "string" ? datos.nombre.trim() : "";
    const nueva = {
      slug: datos.slug,
      nombre,
      nivel: datos.nivel,
      publicada: false,
      orden: Math.max(0, ...todas.map((p) => p.orden)) + 1,
      marcasCatalogo: datos.marcasCatalogo,
      bajada: "",
      bloques: contenidoInicial(datos.nivel, nombre),
      visibilidad: {},
    };
    const r = comoGuardable(nueva);
    if (!r.ok) return r;
    if (todas.some((p) => p.slug === r.pagina.slug) || (await leerSeccionHome(claveDeMarca(r.pagina.slug))) !== undefined) {
      return { ok: false, errores: [YA_EXISTE] };
    }
    await escribir(r.pagina);
    updateTag(TAG_HOME);
    return { ok: true };
  });
}

type DatosEditables = Partial<
  Pick<PaginaMarca, "nombre" | "nivel" | "marcasCatalogo" | "logo" | "bajada" | "tema" | "acento" | "seo" | "publicada">
>;
const CAMPOS_DATOS = ["nombre", "nivel", "marcasCatalogo", "logo", "bajada", "tema", "acento", "seo", "publicada"] as const;

/** Datos generales (no el slug, ni el orden, ni los bloques). */
export async function guardarDatosMarca(slug: string, datos: DatosEditables): Promise<ResultadoMarca> {
  return comoAdmin("guardar datos", async () => {
    const actual = await leerPagina(slug);
    if (!actual) return { ok: false, errores: [NO_EXISTE] };
    const cambios: Record<string, unknown> = {};
    for (const campo of CAMPOS_DATOS) {
      if (datos && campo in datos) cambios[campo] = (datos as Record<string, unknown>)[campo];
    }
    const r = comoGuardable({ ...actual, ...cambios, slug: actual.slug });
    if (!r.ok) return r;
    await escribir(r.pagina);
    updateTag(TAG_HOME);
    return { ok: true };
  });
}

export async function guardarBloqueMarca(slug: string, bloque: BloqueMarca, payload: unknown): Promise<ResultadoMarca> {
  return comoAdmin("guardar bloque", async () => {
    if (!esBloqueMarca(bloque)) return { ok: false, errores: [BLOQUE_AJENO] };
    const actual = await leerPagina(slug);
    if (!actual) return { ok: false, errores: [NO_EXISTE] };
    if (!bloqueDelNivel(actual.nivel, bloque)) return { ok: false, errores: [BLOQUE_AJENO] };
    const errores = validarBloqueMarca(bloque, payload, hostsDeMedios());
    if (errores.length > 0) return { ok: false, errores };
    const contenido = sanearContenidoBloque(bloque, payload);
    await escribir({ ...actual, bloques: { ...actual.bloques, [bloque]: contenido } });
    updateTag(TAG_HOME);
    return { ok: true };
  });
}

/**
 * El encabezado completo de una página: lo que se ve en esa franja (nombre, bajada, logo) más el
 * bloque `hero` (foto de fondo, sello, botón), en UNA escritura. Es lo que guarda "Editar:
 * Encabezado"; los datos generales siguen también en "Datos de la página".
 */
export async function guardarEncabezadoMarca(
  slug: string,
  datos: { nombre: string; bajada: string; logo?: string; hero: unknown },
): Promise<ResultadoMarca> {
  return comoAdmin("guardar encabezado", async () => {
    const actual = await leerPagina(slug);
    if (!actual) return { ok: false, errores: [NO_EXISTE] };
    const erroresHero = validarBloqueMarca("hero", datos?.hero, hostsDeMedios());
    const r = comoGuardable({
      ...actual,
      nombre: typeof datos?.nombre === "string" ? datos.nombre.trim() : "",
      bajada: typeof datos?.bajada === "string" ? datos.bajada : "",
      logo: datos?.logo || undefined,
      slug: actual.slug,
    });
    if (erroresHero.length > 0 || !r.ok) return { ok: false, errores: [...(r.ok ? [] : r.errores), ...erroresHero] };
    await escribir({ ...r.pagina, bloques: { ...r.pagina.bloques, hero: sanearContenidoBloque("hero", datos.hero) } });
    updateTag(TAG_HOME);
    return { ok: true };
  });
}

export async function cambiarVisibilidadBloqueMarca(
  slug: string,
  bloque: BloqueMarca,
  visibilidad: Visibilidad,
): Promise<ResultadoMarca> {
  return comoAdmin("visibilidad", async () => {
    if (!esBloqueMarca(bloque) || !(VISIBILIDADES as readonly unknown[]).includes(visibilidad)) {
      return { ok: false, errores: [BLOQUE_AJENO] };
    }
    const actual = await leerPagina(slug);
    if (!actual) return { ok: false, errores: [NO_EXISTE] };
    if (!bloqueDelNivel(actual.nivel, bloque)) return { ok: false, errores: [BLOQUE_AJENO] };
    await escribir({ ...actual, visibilidad: { ...actual.visibilidad, [bloque]: visibilidad } });
    updateTag(TAG_HOME);
    return { ok: true };
  });
}

/** Intercambia el `orden` con la vecina (en el orden que se muestra). */
export async function moverPaginaMarca(slug: string, direccion: "arriba" | "abajo"): Promise<ResultadoMarca> {
  return comoAdmin("mover", async () => {
    const todas = await leerTodas();
    const i = todas.findIndex((p) => p.slug === slug);
    if (i < 0) return { ok: false, errores: [NO_EXISTE] };
    const j = direccion === "arriba" ? i - 1 : i + 1;
    if (j < 0 || j >= todas.length) return { ok: true };
    const [a, b] = [todas[i], todas[j]];
    // Mismo orden (filas viejas): se separan para que el intercambio se note.
    const [ordenA, ordenB] = a.orden === b.orden ? [b.orden + (j > i ? 1 : -1), a.orden] : [b.orden, a.orden];
    await Promise.all([escribir({ ...a, orden: ordenA }), escribir({ ...b, orden: ordenB })]);
    updateTag(TAG_HOME);
    return { ok: true };
  });
}

export async function borrarPaginaMarca(slug: string): Promise<ResultadoMarca> {
  return comoAdmin("borrar", async () => {
    if (!esSlugMarca(slug)) return { ok: false, errores: [NO_EXISTE] };
    await borrarSeccionHome(claveDeMarca(slug));
    updateTag(TAG_HOME);
    return { ok: true };
  });
}

/** Todas las páginas (publicadas o no), sin caché, para `/editar-marcas`. */
export async function leerPaginasMarcaParaEditor(): Promise<
  { ok: true; paginas: PaginaMarca[] } | { ok: false; error: string }
> {
  if (!(await esAdmin())) return { ok: false, error: SIN_PERMISO };
  try {
    return { ok: true, paginas: await leerTodas() };
  } catch (err) {
    console.error("[marcas-acciones] leer páginas:", err);
    return { ok: false, error: ERROR_LEER };
  }
}

/** Una página fresca (sin caché), para los diálogos de edición. */
export async function leerPaginaMarcaParaEditar(
  slug: string,
): Promise<{ ok: true; pagina: PaginaMarca } | { ok: false; error: string }> {
  if (!(await esAdmin())) return { ok: false, error: SIN_PERMISO };
  try {
    const pagina = await leerPagina(slug);
    return pagina ? { ok: true, pagina } : { ok: false, error: NO_EXISTE };
  } catch (err) {
    console.error("[marcas-acciones] leer página:", err);
    return { ok: false, error: ERROR_LEER };
  }
}

/** Valores de marca reales del catálogo (sin stock ni zona), para el selector del editor. */
export async function valoresMarcaParaEditor(): Promise<
  { ok: true; valores: { valor: string; count: number }[] } | { ok: false; error: string }
> {
  if (!(await esAdmin())) return { ok: false, error: SIN_PERMISO };
  try {
    const { soloVisibles } = await flagsPublicos();
    return { ok: true, valores: await getValoresMarca(soloVisibles) };
  } catch (err) {
    console.error("[marcas-acciones] valores de marca:", err);
    return { ok: false, error: "No pudimos leer las marcas del catálogo. Inténtelo nuevamente." };
  }
}
