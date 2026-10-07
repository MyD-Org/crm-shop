"use client";

import Link from "next/link";
import type { ChipSugerido } from "@/lib/busqueda-inteligente/url";
import { MasIcon } from "./iconos";

/**
 * Pieza de la búsqueda inteligente que usa el "sin resultados": el chip que suma
 * un filtro sugerido. La franja "Entendimos" se retiró: lo
 * buscado y lo entendido quedan como chips removibles arriba de la grilla
 * (CatalogoChips), igual que el resto de los filtros.
 */
/** Chip que SUMA un filtro: un link (se abre en otra pestaña, se comparte, vuelve con atrás). */
function ChipSumar({ chip }: { chip: ChipSugerido }) {
  return (
    <Link
      href={chip.href}
      prefetch={false}
      className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 py-1 text-sm font-medium text-text transition-colors hover:border-primary hover:bg-elevated"
    >
      <MasIcon className="shrink-0 text-muted" />
      {chip.etiqueta}
    </Link>
  );
}

export { ChipSumar };
