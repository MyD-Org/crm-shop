/**
 * Búsquedas frecuentes para la guía del buscador, cacheadas una hora
 * (`'use cache: remote'`, perfil `busquedas` de next.config.ts) y compartidas
 * por todos los visitantes: son iguales para todos. SOLO servidor.
 *
 * Si la caché de interpretaciones no responde, sale vacío y se guarda con el
 * perfil `degradado` (minutos), no por una hora. Si falla la caché misma, se lee
 * sin caché (`conRespaldoSinCache`).
 */
import { cacheLife } from "next/cache";
import { conRespaldoSinCache } from "../cache-respaldo";
import { getArbolCategorias } from "../catalog";
import { busquedasFrecuentes } from "./cache";
import { esBusquedaPublicable, vocabularioConocido } from "./publicable";

/** Cuántas se muestran en la guía. */
export const CANTIDAD_FRECUENTES = 6;
/** Candidatas que se leen para quedarse con las publicables. */
const CANDIDATAS = 30;

export function busquedasFrecuentesCacheadas(tenantId: string): Promise<string[]> {
  return conRespaldoSinCache(
    "busquedas-frecuentes",
    () => frecuentesDeCache(tenantId),
    () => leerFrecuentes(tenantId),
  );
}

async function frecuentesDeCache(tenantId: string): Promise<string[]> {
  "use cache: remote";
  console.info("[cache] busquedas-frecuentes miss");
  const busquedas = await leerFrecuentes(tenantId);
  if (busquedas.length) cacheLife("busquedas");
  else cacheLife("degradado");
  return busquedas;
}

async function leerFrecuentes(tenantId: string): Promise<string[]> {
  // Sólo las que están hechas de vocabulario conocido (ver publicable.ts): el
  // mínimo de usos solo no alcanza para publicar texto escrito por visitantes.
  const [candidatas, arbol] = await Promise.all([
    busquedasFrecuentes(tenantId, CANDIDATAS),
    getArbolCategorias().catch(() => []),
  ]);
  const vocabulario = vocabularioConocido(arbol);
  return candidatas.filter((q) => esBusquedaPublicable(q, vocabulario)).slice(0, CANTIDAD_FRECUENTES);
}
