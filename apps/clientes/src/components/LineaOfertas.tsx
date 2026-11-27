"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useOfertasCuenta } from "@/hooks/useOfertasCuenta";
import { HREF_OFERTAS } from "@/lib/catalogo-url";
import { hayOfertasParaCuenta } from "@/lib/ofertas-cuenta";

/** Textos de la línea de ofertas de la barra de arriba (usted). */
export const TEXTOS_BARRA_OFERTAS = {
  marca: "Ofertas",
  /** Con varias campañas a la vez no se elige una etiqueta: va el título del bloque de la home. */
  varias: "Precios especiales por tiempo limitado",
  ver: "Ver ofertas",
} as const;

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
 * La línea de ofertas según la cuenta: a una cuenta con lista propia sin ninguna oferta que le
 * aplique (su precio ya es menor que el de campaña) no se le anuncian ofertas: queda el anuncio.
 */
export function LineaOfertasCuenta({ texto, clases, anuncio }: { texto: string; clases?: string; anuncio: ReactNode }) {
  const ofertas = useOfertasCuenta();
  return hayOfertasParaCuenta(ofertas) ? <LineaOfertas texto={texto} clases={clases} /> : <>{anuncio}</>;
}
