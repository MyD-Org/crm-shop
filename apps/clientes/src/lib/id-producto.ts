/**
 * ¿Es un id de producto del Shop? Es el `alegraId` del espejo: un entero (cuenta
 * principal de Alegra) o `<slug>:<entero>` (producto que existe sólo en una cuenta
 * secundaria, p. ej. `mdp:12`). El slug empieza con letra para que un id nunca se
 * confunda con el par `id:qty` del link de carrito compartido.
 *
 * Módulo puro (sin DB ni Next): lo usan servidor y navegador. NO reemplaza a
 * `esIdAlegra` (lib/alegra.ts), que sigue estricto donde el id termina en una ruta
 * de Alegra o identifica contactos y documentos.
 */

/** Mismo tope que ya usaban el carrito y los favoritos (64). */
export const ID_PRODUCTO_MAX_LARGO = 64;

export const ID_PRODUCTO_RE = /^(?:\d+|[a-z][a-z0-9-]{1,11}:\d+)$/;

/**
 * Id tal como llega en el segmento de ruta (`/producto/mdp%3A12`): según cómo lo
 * entregue Next puede venir codificado o no, así que se decodifica de forma
 * defensiva (idempotente para ids ya decodificados; un `%` suelto lo rechaza
 * después `esIdProducto`). Nunca lanza.
 */
export function idDeRuta(segmento: string): string {
  try {
    return decodeURIComponent(segmento);
  } catch {
    return segmento;
  }
}

export function esIdProducto(id: unknown): id is string {
  return typeof id === "string" && id.length <= ID_PRODUCTO_MAX_LARGO && ID_PRODUCTO_RE.test(id);
}
