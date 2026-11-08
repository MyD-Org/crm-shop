import { cacheLife, cacheTag } from "next/cache";
import {
  combinarContenidoHome as combinar,
  defaultsHomeDe,
  DEFAULTS_LEGAL,
  KEY_LEGAL,
  resolverDatosLegales,
  type DatosLegales,
  type HomeContent,
} from "@/data/home-defaults";
import { KEY_FOOTER, defaultsFooterDe, resolverDatosFooter, type DatosFooter } from "@/data/footer";
import { DECORACION_POR_DEFECTO, KEY_DECORACION, resolverDecoracion, type Decoracion } from "@/data/decoracion";
import { getMarca } from "@/lib/marca";
import { leerSeccionHome, leerSeccionesHome, leerTodasSeccionesHome, leerWhatsappDelPrincipal } from "@/lib/home-guardar";
import { TAG_HOME } from "@/lib/cache-tags";
import { claveSitio, resolverSitioPorClave } from "@/lib/sitio";
import { leerDestinosExtra } from "@/lib/sitio-datos";

export function combinarContenidoHome(
  filas: { key: string; payload: unknown }[],
  defaults?: HomeContent,
): HomeContent {
  return combinar(filas, defaults);
}

/**
 * Contenido de la home (home, anuncio y badge del nav). Lee home_content y
 * mergea con defaults; si la DB falla o está vacía, los defaults hacen que la
 * home nunca se rompa.
 *
 * Cacheado (`'use cache'`, tag `home`): va en el shell estático de todas las
 * páginas, así un visitante no despierta la base. Lo invalida el editor con
 * `updateTag(TAG_HOME)` (src/lib/home-acciones.ts). Si la DB falla, los
 * defaults se guardan con el perfil `degradado` (minutos), nunca por días: con
 * Cache Components esto también corre en el build.
 */
export async function getContenidoHome(): Promise<HomeContent> {
  return contenidoDelSitio(claveSitio());
}

/** La clave del sitio viaja como argumento: entra en la clave de caché (un sitio no ve la de otro). */
async function contenidoDelSitio(sitio: string): Promise<HomeContent> {
  "use cache";
  cacheTag(TAG_HOME);
  console.info("[cache] home miss");
  // Los defaults dependen de la marca (Central o genérica). `getMarca` no lanza.
  const defaults = defaultsHomeDe(await getMarca());
  try {
    const filas = await leerTodasSeccionesHome(sitio);
    cacheLife("home");
    return combinar(filas, defaults);
  } catch (err) {
    console.error("[home] home_content no disponible, uso defaults:", err);
    cacheLife("degradado");
    return defaults;
  }
}

/**
 * Filas `legal` y `footer` de home_content, en una sola consulta: las leen el
 * footer (todas las páginas) y las páginas legales. Cacheadas con el mismo
 * tag que la home (las escribe el mismo editor). `null` = la DB falló.
 */
async function filasFooter(sitio: string): Promise<{ legal: unknown; footer: unknown } | null> {
  "use cache";
  cacheTag(TAG_HOME);
  console.info("[cache] legales miss");
  try {
    const filas = await leerSeccionesHome([KEY_LEGAL, KEY_FOOTER], sitio);
    cacheLife("home");
    return { legal: filas.get(KEY_LEGAL), footer: filas.get(KEY_FOOTER) };
  } catch (err) {
    console.error("[legales] home_content no disponible:", err);
    cacheLife("degradado");
    return null;
  }
}

/**
 * Datos legales del comercio (fila `legal` de home_content). Los leen el
 * footer y las páginas legales: si la DB falla, vacíos, y las páginas omiten
 * la identificación en vez de romperse.
 */
export async function getDatosLegales(): Promise<DatosLegales> {
  const filas = await filasFooter(claveSitio());
  return filas ? resolverDatosLegales(filas.legal) : DEFAULTS_LEGAL;
}

/**
 * Contenido editable del footer (fila `footer`). Sin fila o si la DB falla,
 * los defaults: el footer de siempre.
 */
export async function getDatosFooter(): Promise<DatosFooter> {
  return footerDelSitio(claveSitio());
}

async function footerDelSitio(sitio: string): Promise<DatosFooter> {
  "use cache";
  cacheTag(TAG_HOME);
  const defaults = defaultsFooterDe(await getMarca());
  const filas = await filasFooter(sitio);
  if (!filas) {
    cacheLife("degradado");
    return defaults;
  }
  const footer = resolverDatosFooter(filas.footer, defaults);
  if (footer.whatsapp) {
    cacheLife("home");
    return footer;
  }
  // Sitio propio sin WhatsApp: toma el número del principal (sólo ese campo).
  try {
    const propio = sitio !== "|" && resolverSitioPorClave(sitio, await leerDestinosExtra()).propio;
    const salida = propio ? { ...footer, whatsapp: await leerWhatsappDelPrincipal() } : footer;
    cacheLife("home");
    return salida;
  } catch (err) {
    console.error("[footer] no se pudo leer el WhatsApp del principal:", err);
    cacheLife("degradado");
    return footer;
  }
}

/**
 * Decoración del sitio (fila `decoracion`: hoy sólo `piedra`, la textura de la piedra de Mar del
 * Plata). Cacheada con el tag `home`; la clave del sitio viaja como argumento. Sin fila, con un
 * payload inválido o si la DB falla: todo apagado (el aspecto de siempre).
 */
export async function getDecoracion(): Promise<Decoracion> {
  return decoracionDelSitio(claveSitio());
}

async function decoracionDelSitio(sitio: string): Promise<Decoracion> {
  "use cache";
  cacheTag(TAG_HOME);
  try {
    const raw = await leerSeccionHome(KEY_DECORACION, sitio);
    cacheLife("home");
    return resolverDecoracion(raw);
  } catch (err) {
    console.error("[decoracion] home_content no disponible, queda apagada:", err);
    cacheLife("degradado");
    return DECORACION_POR_DEFECTO;
  }
}
