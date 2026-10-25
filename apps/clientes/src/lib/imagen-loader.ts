/**
 * Loader de `next/image` para toda la tienda (next.config.ts → images.loaderFile).
 *
 * Las imágenes NO pasan por el optimizador de Vercel: en el plan Hobby su cuota
 * mensual se agota y a partir de ahí toda imagen que no esté en caché responde
 * 402 y la card queda rota.
 *
 * - Fotos del catálogo (overlay del CRM en R2): el admin ya sube cada foto en
 *   los anchos de ANCHOS_FOTO (`<uuid>-320.webp`, `-800.webp`, `-1600.webp`;
 *   las tres existen siempre, aunque la original sea más chica). Se pide la
 *   más chica que cubra el ancho del srcset.
 * - Cualquier otra URL (imágenes de la home, logos, archivos de public/) se
 *   sirve tal cual.
 *
 * Módulo PURO y sin alias `@/`: lo carga next/image en cliente y en server.
 */
const VARIANTE = /-(320|800|1600)\.webp$/;
const ANCHOS = [320, 800, 1600] as const;

export default function cargadorImagen({ src, width }: { src: string; width: number; quality?: number }): string {
  if (!VARIANTE.test(src)) return src;
  const ancho = ANCHOS.find((a) => a >= width) ?? ANCHOS[ANCHOS.length - 1];
  return src.replace(VARIANTE, `-${ancho}.webp`);
}
