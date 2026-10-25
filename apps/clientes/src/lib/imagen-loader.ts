/**
 * Loader de `next/image` para toda la tienda (next.config.ts → images.loaderFile).
 *
 * Las imágenes NO pasan por el optimizador de Vercel: en el plan Hobby su cuota
 * mensual se agota y a partir de ahí toda imagen que no esté en caché responde
 * 402 y la card queda rota.
 *
 * - Fotos del catálogo (overlay del CRM en R2): cada foto se guarda en anchos
 *   de 320/800/1600 (`<uuid>-320.webp`, ...). La URL que llega es la variante
 *   MÁS GRANDE que figura en el overlay; no todas las fotos tienen las tres
 *   (hay cargas con sólo 320 y 800), así que nunca se pide una más grande que
 *   esa. Dentro de ese tope, la más chica que cubra el ancho del srcset.
 * - Cualquier otra URL (imágenes de la home, logos, archivos de public/) se
 *   sirve tal cual.
 *
 * Módulo PURO y sin alias `@/`: lo carga next/image en cliente y en server.
 */
const VARIANTE = /-(320|800|1600)\.webp$/;
const ANCHOS = [320, 800, 1600] as const;

export default function cargadorImagen({ src, width }: { src: string; width: number; quality?: number }): string {
  const m = VARIANTE.exec(src);
  if (!m) return src;
  const tope = Number(m[1]);
  const disponibles = ANCHOS.filter((a) => a <= tope);
  const ancho = disponibles.find((a) => a >= width) ?? tope;
  return src.replace(VARIANTE, `-${ancho}.webp`);
}
