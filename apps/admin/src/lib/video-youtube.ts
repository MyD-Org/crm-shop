/**
 * Videos de YouTube de un producto. Del enlace público sólo se conserva el id (11 caracteres): no
 * se guardan URLs libres, el embed y el poster los compone el Shop al leer. Cualquier otro
 * proveedor, `http` o un id mal formado no es un video válido.
 *
 * La misma regla vive en `apps/clientes/src/lib/marcas/video.ts` (no hay código compartido entre
 * las apps): un test en cada una fija los mismos casos.
 */
export const MAX_VIDEOS = 3

const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/

export const esIdYoutube = (id: unknown): id is string => typeof id === "string" && ID_YOUTUBE.test(id)

/** Id de YouTube de un enlace https (watch, youtu.be, shorts, embed; con o sin www/m), o null. */
export function idYoutubeDeEnlace(url: unknown): string | null {
  if (typeof url !== "string") return null
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== "https:") return null
  const host = u.hostname.replace(/^www\.|^m\./, "")
  const partes = u.pathname.split("/").filter(Boolean)
  let id: string | null = null
  if (host === "youtube.com") {
    id = partes[0] === "watch" ? u.searchParams.get("v") : partes[0] === "shorts" || partes[0] === "embed" ? (partes[1] ?? null) : null
  } else if (host === "youtu.be") {
    id = partes[0] ?? null
  }
  return esIdYoutube(id) ? id : null
}

export type ResultadoVideos = { ok: true; videos: { id: string }[] } | { ok: false; error: string }

/** Valida la lista final que llega a la API: ids bien formados, sin repetir y hasta MAX_VIDEOS. */
export function validarVideos(entrada: unknown): ResultadoVideos {
  if (!Array.isArray(entrada)) return { ok: false, error: "Indique los videos del producto." }
  if (entrada.length > MAX_VIDEOS) return { ok: false, error: `Se admiten hasta ${MAX_VIDEOS} videos por producto.` }
  const videos: { id: string }[] = []
  for (const v of entrada) {
    const id = (v as { id?: unknown } | null)?.id
    if (!esIdYoutube(id)) return { ok: false, error: "Ingrese un enlace de YouTube." }
    if (videos.some((x) => x.id === id)) return { ok: false, error: "Ese video ya está cargado." }
    videos.push({ id })
  }
  return { ok: true, videos }
}
