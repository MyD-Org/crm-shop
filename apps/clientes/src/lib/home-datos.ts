import { cacheLife, cacheTag } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { homeContent } from "@/db/schema";
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
import { getMarca } from "@/lib/marca";
import { leerSeccionesHome } from "@/lib/home-guardar";
import { TAG_HOME } from "@/lib/cache-tags";
import { shopTenantId } from "@/lib/tenant";

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
  "use cache";
  cacheTag(TAG_HOME);
  console.info("[cache] home miss");
  // Los defaults dependen de la marca (Central o genérica). `getMarca` no lanza.
  const defaults = defaultsHomeDe(await getMarca());
  try {
    const filas = await getDb()
      .select()
      .from(homeContent)
      .where(eq(homeContent.tenantId, shopTenantId()));
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
async function filasFooter(): Promise<{ legal: unknown; footer: unknown } | null> {
  "use cache";
  cacheTag(TAG_HOME);
  console.info("[cache] legales miss");
  try {
    const filas = await leerSeccionesHome([KEY_LEGAL, KEY_FOOTER]);
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
  const filas = await filasFooter();
  return filas ? resolverDatosLegales(filas.legal) : DEFAULTS_LEGAL;
}

/**
 * Contenido editable del footer (fila `footer`). Sin fila o si la DB falla,
 * los defaults: el footer de siempre.
 */
export async function getDatosFooter(): Promise<DatosFooter> {
  const defaults = defaultsFooterDe(await getMarca());
  const filas = await filasFooter();
  return filas ? resolverDatosFooter(filas.footer, defaults) : defaults;
}
