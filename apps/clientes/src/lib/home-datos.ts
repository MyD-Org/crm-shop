import { cache } from "react";
import { getDb } from "@/db";
import { homeContent } from "@/db/schema";
import {
  combinarContenidoHome as combinar,
  DEFAULTS_LEGAL,
  KEY_LEGAL,
  resolverDatosLegales,
  type DatosLegales,
  type HomeContent,
} from "@/data/home-defaults";
import { DEFAULTS_FOOTER, KEY_FOOTER, resolverDatosFooter, type DatosFooter } from "@/data/footer";
import { leerSeccionesHome } from "@/lib/home-guardar";

export function combinarContenidoHome(filas: { key: string; payload: unknown }[]): HomeContent {
  return combinar(filas);
}

/**
 * Contenido de la home para este request. Lee home_content y mergea con
 * defaults; si la DB falla o está vacía, los defaults hacen que la home
 * nunca se rompa. Igual criterio que getOfertaCuotas (cache por request,
 * fallback en error).
 */
export const getContenidoHome = cache(async (): Promise<HomeContent> => {
  try {
    const filas = await getDb().select().from(homeContent);
    return combinar(filas);
  } catch (err) {
    console.error("[home] home_content no disponible, uso defaults:", err);
    const { DEFAULTS_HOME } = await import("@/data/home-defaults");
    return DEFAULTS_HOME;
  }
});

/**
 * Filas `legal` y `footer` de home_content, en una sola consulta por request:
 * las leen el footer (todas las páginas) y las páginas legales.
 */
const getFilasFooter = cache(() => leerSeccionesHome([KEY_LEGAL, KEY_FOOTER]));

/**
 * Datos legales del comercio (fila `legal` de home_content) para este request.
 * Los leen el footer y las páginas legales: si la DB falla, vacíos, y las
 * páginas omiten la identificación en vez de romperse.
 */
export const getDatosLegales = cache(async (): Promise<DatosLegales> => {
  try {
    return resolverDatosLegales((await getFilasFooter()).get(KEY_LEGAL));
  } catch (err) {
    console.error("[legales] home_content no disponible:", err);
    return DEFAULTS_LEGAL;
  }
});

/**
 * Contenido editable del footer (fila `footer`) para este request. Sin fila o
 * si la DB falla, los defaults: el footer de siempre.
 */
export const getDatosFooter = cache(async (): Promise<DatosFooter> => {
  try {
    return resolverDatosFooter((await getFilasFooter()).get(KEY_FOOTER));
  } catch (err) {
    console.error("[footer] home_content no disponible:", err);
    return DEFAULTS_FOOTER;
  }
});
