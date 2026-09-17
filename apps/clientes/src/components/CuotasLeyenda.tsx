import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";

/**
 * Leyenda de referencia: obligatoria en toda superficie previa al Brick que
 * muestre cuotas. `corta` para la card del catálogo. Texto en cuotas-textos.ts.
 */
export function CuotasLeyenda({ corta = false, className = "" }: { corta?: boolean; className?: string }) {
  return (
    <p className={`text-[11px] leading-snug text-muted ${className}`}>
      {corta ? TEXTOS_CUOTAS.leyendaCorta : TEXTOS_CUOTAS.leyenda}
    </p>
  );
}
