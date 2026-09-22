/**
 * Lógica del corazón de favoritos en el navegador. Módulo PURO: lo usa
 * `FavoritosContext` y se testea en node (el Shop no tiene jsdom).
 */

export type MetodoFavorito = "PUT" | "DELETE";

/** Estado optimista tras pulsar el corazón de `id`, y qué pedirle a la API. */
export function reducirToggle(
  ids: ReadonlySet<string>,
  id: string,
): { siguiente: Set<string>; metodo: MetodoFavorito } {
  const siguiente = new Set(ids);
  if (siguiente.has(id)) {
    siguiente.delete(id);
    return { siguiente, metodo: "DELETE" };
  }
  siguiente.add(id);
  return { siguiente, metodo: "PUT" };
}

/** Deshace el cambio optimista de `id` (sólo ese: otros toggles quedan). */
export function revertir(ids: ReadonlySet<string>, id: string, metodo: MetodoFavorito): Set<string> {
  const previo = new Set(ids);
  if (metodo === "PUT") previo.delete(id);
  else previo.add(id);
  return previo;
}

const GENERICO = "No pudimos guardar el favorito. Inténtelo de nuevo.";

/**
 * Texto del toast cuando la API no guardó. `status` 0 = error de red. Sólo el
 * 422 (tope) muestra el mensaje del servidor: los demás pueden traer detalle
 * que no es para el visitante.
 */
export function mensajeError(status: number, body?: { error?: unknown } | null): string {
  if (status === 429) return "Demasiadas solicitudes. Inténtelo de nuevo en unos minutos.";
  if (status === 422 && typeof body?.error === "string" && body.error) return body.error;
  return GENERICO;
}

/**
 * ¿Se muestra el corazón? Con Clerk, sí; anónimo, también (al tocarlo se abre
 * el ingreso). Con la cookie del CRM y sin Clerk no hay dónde guardar: no.
 */
export function disponible({
  isSignedIn,
  favoritosBloqueados,
}: {
  isSignedIn: boolean | undefined;
  favoritosBloqueados: boolean;
}): boolean {
  return !!isSignedIn || !favoritosBloqueados;
}
