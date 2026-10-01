/**
 * Flag de la búsqueda inteligente del catálogo (spec catálogo asistido,
 * platform 2026-09-29). Se lee sólo en el server.
 *
 * Apagado (default): el catálogo, el buscador y sus endpoints quedan
 * idénticos a los de siempre; `/api/shop/busquedas-frecuentes` responde 404 y
 * no sale ninguna llamada a Jev ni se lee/escribe la caché de interpretaciones.
 *
 * Prendido (búsqueda v2, src/lib/busqueda-v2/):
 * - El buscador del header, la sección "Cuéntenos qué necesita" del inicio y
 *   el "sin resultados" envían a `/buscar`, que entiende la consulta (caché,
 *   diccionario, sinónimos y Jev) y redirige con 307 a
 *   `/catalogo?q=…&categoria=…&atr=…&ia=1`. La página nunca redirige en el
 *   render: con `ia=1` lee el plan y la franja muestra lo entendido.
 * - El buscador del header rota ejemplos en el placeholder y muestra la guía
 *   al enfocar (ejemplos y búsquedas frecuentes).
 *
 * Sin `JEV_API_KEY` sigue funcionando sólo con lo determinista (diccionario,
 * sinónimos y nombres de categoría), sin costo.
 *
 * Vive en Vercel Flags (key `busqueda-ia`, ver src/flags.ts): se cambia sin redeploy.
 */
import { busquedaIaFlag } from "@/flags";

export async function busquedaIaHabilitada(): Promise<boolean> {
  return busquedaIaFlag();
}
