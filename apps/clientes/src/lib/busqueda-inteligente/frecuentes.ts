/**
 * Búsquedas frecuentes para la guía del buscador, cacheadas una hora
 * (`'use cache: remote'`, perfil `busquedas` de next.config.ts) y compartidas
 * por todos los visitantes: son iguales para todos. SOLO servidor.
 *
 * Si la caché de interpretaciones no responde, sale vacío y se guarda con el
 * perfil `degradado` (minutos), no por una hora.
 */
import { cacheLife } from "next/cache";
import { busquedasFrecuentes } from "./cache";

/** Cuántas se muestran en la guía. */
export const CANTIDAD_FRECUENTES = 6;

export async function busquedasFrecuentesCacheadas(tenantId: string): Promise<string[]> {
  "use cache: remote";
  console.info("[cache] busquedas-frecuentes miss");
  const busquedas = await busquedasFrecuentes(tenantId, CANTIDAD_FRECUENTES);
  if (busquedas.length) cacheLife("busquedas");
  else cacheLife("degradado");
  return busquedas;
}
