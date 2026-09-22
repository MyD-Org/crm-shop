/**
 * Hosts de medios del catálogo (fotos del overlay del CRM).
 *
 * `next/image` sólo optimiza URLs remotas cuyo host figure en
 * `images.remotePatterns` (next.config.ts); cualquier otra responde 400 y la
 * card quedaría con la imagen rota. Por eso la misma lista decide dos cosas:
 * qué hosts acepta el optimizador y qué fotos llegan a la card. Una foto de un
 * host no configurado se descarta en el server y la card muestra el
 * placeholder.
 *
 * La lista sale de `SHOP_MEDIA_HOSTS` (hosts separados por coma). Nunca un host
 * literal en el repo: es público.
 *
 * Módulo PURO y sin alias `@/`: lo importa también next.config.ts.
 */
import type { ProductImage } from "../data/products";

/** Parsea `SHOP_MEDIA_HOSTS`: hosts separados por coma, sin vacíos. */
export function hostsDeMedios(
  valor: string | undefined = process.env.SHOP_MEDIA_HOSTS,
): string[] {
  return (valor ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

/**
 * Fotos que se pueden servir: https y de un host configurado. undefined si no
 * queda ninguna (sin fotos cargadas o sin hosts), para que la card muestre el
 * placeholder.
 */
export function fotosPermitidas(
  fotos: readonly ProductImage[] | null | undefined,
  hosts: readonly string[],
): ProductImage[] | undefined {
  if (!fotos?.length || !hosts.length) return undefined;
  const permitidas = fotos
    .filter((f) => {
      try {
        const u = new URL(f.url);
        return u.protocol === "https:" && hosts.includes(u.hostname);
      } catch {
        return false;
      }
    })
    .map(({ url, w, alt }) => (alt === undefined ? { url, w } : { url, w, alt }));
  return permitidas.length ? permitidas : undefined;
}
