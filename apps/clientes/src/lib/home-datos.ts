import { cache } from "react";
import { getDb } from "@/db";
import { homeContent } from "@/db/schema";
import {
  combinarContenidoHome as combinar,
  type HomeContent,
} from "@/data/home-defaults";

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
