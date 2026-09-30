/**
 * Flag de la búsqueda inteligente del catálogo (spec catálogo asistido,
 * platform 2026-09-29). Se lee sólo en el server.
 *
 * Apagado (default): el catálogo, el buscador y sus endpoints quedan
 * idénticos a los de siempre; `/api/shop/busquedas-frecuentes` responde 404 y
 * no sale ninguna llamada a Jev ni se lee/escribe la caché de interpretaciones.
 *
 * Prendido:
 * - `/catalogo` interpreta las búsquedas en lenguaje natural o con pocos
 *   resultados (src/lib/busqueda-inteligente/): con 0–3 resultados redirige a
 *   la URL interpretada (`ia=<consulta>`); con resultados, la franja
 *   "Entendimos" ofrece los filtros como sugerencias.
 * - El buscador del header rota ejemplos en el placeholder y muestra la guía
 *   al enfocar (ejemplos y búsquedas frecuentes).
 *
 * Sin `JEV_API_KEY` sigue funcionando sólo con lo determinista (diccionario de
 * atributos y nombres de categoría), sin costo.
 *
 * Vive en Vercel Flags (key `busqueda-ia`, ver src/flags.ts): se cambia sin redeploy.
 */
import { busquedaIaFlag } from "@/flags";

export async function busquedaIaHabilitada(): Promise<boolean> {
  return busquedaIaFlag();
}
