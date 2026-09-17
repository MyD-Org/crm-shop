import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";

/**
 * Leyenda de referencia: obligatoria en toda superficie previa al Brick que
 * muestre cuotas. `corta` para la card del catálogo, donde va al lado de la
 * línea de cuotas y todavía más chica y apagada. Texto en cuotas-textos.ts.
 */
export function CuotasLeyenda({ corta = false, className = "" }: { corta?: boolean; className?: string }) {
  if (corta) {
    return <span className={`text-[10px] leading-snug text-muted ${className}`}>{TEXTOS_CUOTAS.leyendaCorta}</span>;
  }
  return <p className={`text-[11px] leading-snug text-muted ${className}`}>{TEXTOS_CUOTAS.leyenda}</p>;
}
