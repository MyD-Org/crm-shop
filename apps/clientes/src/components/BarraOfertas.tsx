import type { ReactNode } from "react";
import Link from "next/link";
import { campaniasVigentes, type CampaniaActiva } from "@/lib/campanias/vigentes";
import { HREF_OFERTAS } from "@/lib/catalogo-url";

/** Textos de la línea de ofertas de la barra de arriba (usted). */
export const TEXTOS_BARRA_OFERTAS = {
  marca: "Ofertas",
  /** Con varias campañas a la vez no se elige una etiqueta: va el título del bloque de la home. */
  varias: "Precios especiales por tiempo limitado",
  ver: "Ver ofertas",
} as const;

/** Qué dice la línea: la etiqueta de la campaña (la que ve el cliente en las cards) o el genérico. */
export function textoBarraOfertas(campanias: readonly Pick<CampaniaActiva, "etiqueta">[]): string | null {
  if (campanias.length === 0) return null;
  if (campanias.length === 1) return campanias[0].etiqueta.trim() || TEXTOS_BARRA_OFERTAS.varias;
  return TEXTOS_BARRA_OFERTAS.varias;
}

/**
 * Línea «OFERTAS · <etiqueta> · Ver ofertas» (diseño «Ofertas más llamativas», punto 1): la entrada a
 * las ofertas desde cualquier página. `clases`: dónde se ve (las del anuncio, ver `CentroBarra`).
 */
export function LineaOfertas({ texto, clases = "" }: { texto: string; clases?: string }) {
  return (
    <p data-barra-ofertas="" className={`flex flex-wrap items-center justify-center gap-x-2 text-center text-[12.5px] font-semibold tracking-wide ${clases}`}>
      <span className="font-display font-extrabold uppercase tracking-wider text-highlight">{TEXTOS_BARRA_OFERTAS.marca}</span>
      <span>{texto}</span>
      <Link href={HREF_OFERTAS} className="underline underline-offset-2 transition-colors hover:text-highlight">
        {TEXTOS_BARRA_OFERTAS.ver}
      </Link>
    </p>
  );
}

/**
 * Centro de la barra, hueco por request: la vigencia de las campañas no se calcula en el shell
 * cacheado (`campaniasVigentes` lee el reloj). Con alguna campaña activa, la línea de ofertas
 * reemplaza al anuncio del editor mientras dure; sin campañas (o si la lectura falla: devuelve
 * ninguna), queda el anuncio de siempre, que es también el fallback del Suspense.
 *
 * La línea se ve donde se ve el anuncio (`clases`, default del editor: sólo desktop): en mobile la
 * barra es una columna y una fila nueva al llegar el hueco empujaría la página. Sin anuncio, sólo
 * desktop (ahí la fila ya existe por las redes y el WhatsApp). En mobile llegan por el bloque de la
 * home y el menú; el editor puede poner el anuncio en "siempre" para que también se vea arriba.
 */
export async function CentroBarra({ anuncio, clases }: { anuncio: ReactNode; clases: string }) {
  const texto = textoBarraOfertas(await campaniasVigentes());
  return texto ? <LineaOfertas texto={texto} clases={clases} /> : anuncio;
}
