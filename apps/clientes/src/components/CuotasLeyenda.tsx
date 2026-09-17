import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";

/**
 * Leyenda de referencia. Va en las superficies donde el visitante decide con
 * los números a la vista (ficha y modal de medios de pago), no en las cards
 * del catálogo. Texto en cuotas-textos.ts.
 */
export function CuotasLeyenda({ className = "" }: { className?: string }) {
  return <p className={`text-[11px] leading-snug text-muted ${className}`}>{TEXTOS_CUOTAS.leyenda}</p>;
}
