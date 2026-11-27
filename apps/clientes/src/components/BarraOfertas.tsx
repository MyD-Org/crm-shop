import type { ReactNode } from "react";
import { LineaOfertasCuenta, TEXTOS_BARRA_OFERTAS } from "@/components/LineaOfertas";
import { campaniasVigentes, type CampaniaActiva } from "@/lib/campanias/vigentes";

export { LineaOfertas, TEXTOS_BARRA_OFERTAS } from "@/components/LineaOfertas";

/** Qué dice la línea: la etiqueta de la campaña (la que ve el cliente en las cards) o el genérico. */
export function textoBarraOfertas(campanias: readonly Pick<CampaniaActiva, "etiqueta">[]): string | null {
  if (campanias.length === 0) return null;
  if (campanias.length === 1) return campanias[0].etiqueta.trim() || TEXTOS_BARRA_OFERTAS.varias;
  return TEXTOS_BARRA_OFERTAS.varias;
}

/**
 * Centro de la barra, hueco por request: la vigencia de las campañas no se calcula en el shell
 * cacheado (`campaniasVigentes` lee el reloj). Con alguna campaña activa, la línea de ofertas
 * reemplaza al anuncio del editor mientras dure; sin campañas (o si la lectura falla: devuelve
 * ninguna), queda el anuncio de siempre, que es también el fallback del Suspense. A una cuenta con
 * lista propia sin ninguna oferta que le aplique también le queda el anuncio (`LineaOfertasCuenta`).
 *
 * La línea se ve donde se ve el anuncio (`clases`, default del editor: sólo desktop): en mobile la
 * barra es una columna y una fila nueva al llegar el hueco empujaría la página. Sin anuncio, sólo
 * desktop (ahí la fila ya existe por las redes y el WhatsApp). En mobile llegan por el bloque de la
 * home y el menú; el editor puede poner el anuncio en "siempre" para que también se vea arriba.
 */
export async function CentroBarra({ anuncio, clases }: { anuncio: ReactNode; clases: string }) {
  const texto = textoBarraOfertas(await campaniasVigentes());
  return texto ? <LineaOfertasCuenta texto={texto} clases={clases} anuncio={anuncio} /> : anuncio;
}
