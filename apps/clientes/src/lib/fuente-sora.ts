/**
 * Sora (la fuente de la marca) en TTF para las imágenes que genera `next/og`
 * (src/app/opengraph-image.tsx). next/font sirve WOFF2 y
 * Satori no lo lee, así que se pide a Google Fonts sólo con los glifos que se
 * dibujan. Quien la usa la cachea (`'use cache'`) y degrada si falla.
 */
export type Fuente = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };

export async function sora(peso: 400 | 700, texto: string): Promise<Fuente> {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=Sora:wght@${peso}&text=${encodeURIComponent(texto)}`,
  ).then((r) => r.text());
  const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error("Google Fonts no devolvió un TTF de Sora");
  const data = await fetch(url).then((r) => r.arrayBuffer());
  return { name: "Sora", data, weight: peso, style: "normal" };
}
