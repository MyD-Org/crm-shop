/**
 * Link para compartir una lista de favoritos: `/favoritos/compartido?i=1,2,3`.
 * Módulo PURO (sin base): lo usan el botón de Mi cuenta y la landing.
 *
 * No importa `MAX_FAVORITOS` de `favoritos.ts` porque ese módulo trae la base;
 * el test comprueba que ambas constantes valen lo mismo.
 */
import { esIdAlegra } from "./alegra";
import { MENSAJE_FAVORITOS, mensajeCompartido } from "./carrito-compartido";

export const RUTA_FAVORITOS_COMPARTIDOS = "/favoritos/compartido";

/** Igual a `MAX_FAVORITOS` (favoritos.ts). */
export const MAX_IDS_COMPARTIDOS = 200;

/** Largo máximo del id que se acepta. */
const MAX_LARGO_ID = 64;
/** Se recorta la query antes de parsear: un link de 1 MB no debe costar CPU. */
const MAX_LARGO_QUERY = 4096;

/** Ruta relativa con los ids (sólo los válidos, sin repetir, hasta el tope). */
export function hrefFavoritosCompartidos(ids: readonly string[]): string {
  const limpios = ids.filter((id) => esIdAlegra(id) && id.length <= MAX_LARGO_ID);
  const unicos = [...new Set(limpios)].slice(0, MAX_IDS_COMPARTIDOS);
  return `${RUTA_FAVORITOS_COMPARTIDOS}?i=${unicos.join(",")}`;
}

/** Ids del parámetro `i`. Tolerante: lo inválido se ignora, nunca lanza. */
export function parsearIdsFavoritos(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const vistos = new Set<string>();
  for (const parte of raw.slice(0, MAX_LARGO_QUERY).split(",")) {
    const id = parte.trim();
    if (!esIdAlegra(id) || id.length > MAX_LARGO_ID) continue;
    vistos.add(id);
    if (vistos.size >= MAX_IDS_COMPARTIDOS) break;
  }
  return [...vistos];
}

/** Texto que se manda a un tercero por WhatsApp o la hoja del sistema. */
export function mensajeFavoritos(url: string): string {
  return mensajeCompartido(url, MENSAJE_FAVORITOS);
}
