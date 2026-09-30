/**
 * Búsquedas frecuentes para la guía del buscador, cacheadas una hora
 * (`'use cache: remote'`, perfil `busquedas` de next.config.ts) y compartidas
 * por todos los visitantes: son iguales para todos. SOLO servidor.
 *
 * Si la caché de interpretaciones no responde, sale vacío y se guarda con el
 * perfil `degradado` (minutos), no por una hora.
 */
import { cacheLife } from "next/cache";
import { getArbolCategorias } from "../catalog";
import { busquedasFrecuentes } from "./cache";
import { esBusquedaPublicable, vocabularioConocido } from "./publicable";

/** Cuántas se muestran en la guía. */
export const CANTIDAD_FRECUENTES = 6;
/** Candidatas que se leen para quedarse con las publicables. */
const CANDIDATAS = 30;

export async function busquedasFrecuentesCacheadas(tenantId: string): Promise<string[]> {
  "use cache: remote";
  console.info("[cache] busquedas-frecuentes miss");
  // Sólo las que están hechas de vocabulario conocido (ver publicable.ts): el
  // mínimo de usos solo no alcanza para publicar texto escrito por visitantes.
  const [candidatas, arbol] = await Promise.all([
    busquedasFrecuentes(tenantId, CANDIDATAS),
    getArbolCategorias().catch(() => []),
  ]);
  const vocabulario = vocabularioConocido(arbol);
  const busquedas = candidatas.filter((q) => esBusquedaPublicable(q, vocabulario)).slice(0, CANTIDAD_FRECUENTES);
  if (busquedas.length) cacheLife("busquedas");
  else cacheLife("degradado");
  return busquedas;
}
