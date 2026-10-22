/**
 * Videos de una página de marca (bloque "La empresa"): sólo YouTube y Vimeo, por su enlace
 * público. Del enlace sale el reproductor embebido (YouTube en su dominio sin cookies) y, para
 * YouTube, la miniatura. Cualquier otra cosa no es un video válido (no se embeben URLs libres).
 */
export type VideoEmbebible =
  | { proveedor: "youtube"; id: string; embed: string; poster: string }
  | { proveedor: "vimeo"; id: string; embed: string };

const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;

export function videoEmbebible(url: unknown): VideoEmbebible | null {
  if (typeof url !== "string") return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const partes = u.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtube.com") {
    id = partes[0] === "watch" ? u.searchParams.get("v") : partes[0] === "shorts" || partes[0] === "embed" ? partes[1] ?? null : null;
  } else if (host === "youtu.be") {
    id = partes[0] ?? null;
  }
  if (id && ID_YOUTUBE.test(id)) {
    return {
      proveedor: "youtube",
      id,
      embed: `https://www.youtube-nocookie.com/embed/${id}`,
      poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }
  if (host === "vimeo.com" && partes.length === 1 && /^\d{4,12}$/.test(partes[0])) {
    return { proveedor: "vimeo", id: partes[0], embed: `https://player.vimeo.com/video/${partes[0]}` };
  }
  return null;
}
