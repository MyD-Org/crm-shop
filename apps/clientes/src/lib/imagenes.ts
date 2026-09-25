/**
 * ¿`next/image` puede servir esta imagen por el optimizador (`/_next/image`)?
 *
 * Sí para rutas locales (`/images/…`, sin `//` de protocolo relativo) y para
 * URLs `https:` cuyo host esté en `hosts` (los mismos de `remotePatterns` en
 * next.config.ts). Cualquier otra cosa —otro host, `http:`, `data:`, una URL
 * mal formada— el optimizador la rechaza con 400 y la imagen queda rota: el
 * renderer cae al `<img>` común.
 *
 * Módulo PURO: lo usa el renderer de cliente `imagenNext`.
 */
export function esImagenOptimizable(src: string, hosts: readonly string[]): boolean {
  const u = src.trim();
  if (u.startsWith("/")) return !u.startsWith("//");
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && hosts.includes(parsed.hostname);
}
