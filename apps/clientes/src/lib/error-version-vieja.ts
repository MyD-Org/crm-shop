/**
 * Una pestaña abierta desde antes del último deploy sigue corriendo el JS viejo.
 * Al navegar pide chunks (o server actions) que ya no existen en el deploy nuevo
 * y Next tira el error al boundary. "Reintentar" no lo arregla porque vuelve a
 * renderizar con el mismo JS viejo: hace falta una recarga completa.
 */
const PATRONES = [
  /ChunkLoadError/i,
  /Loading (CSS )?chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Failed to find Server Action/i,
  /Server Action .* was not found/i,
];

export function esErrorDeVersionVieja(error: { name?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const texto = `${error.name ?? ""} ${error.message ?? ""}`;
  return PATRONES.some((p) => p.test(texto));
}

const CLAVE = "recarga-version-vieja";
/** Ventana para no entrar en un bucle de recargas si el error persiste. */
const VENTANA_MS = 60_000;

/**
 * Recarga la página una vez si el error es de versión vieja. Devuelve true si
 * disparó la recarga (el boundary puede no mostrar nada mientras tanto).
 */
export function recargarSiVersionVieja(error: { name?: string; message?: string } | null | undefined): boolean {
  if (typeof window === "undefined" || !esErrorDeVersionVieja(error)) return false;
  try {
    const ultima = Number(window.sessionStorage.getItem(CLAVE) ?? 0);
    if (Date.now() - ultima < VENTANA_MS) return false;
    window.sessionStorage.setItem(CLAVE, String(Date.now()));
  } catch {
    // Sin sessionStorage (modo privado estricto): recargar igual, una sola vez por render.
  }
  window.location.reload();
  return true;
}
