import type { PrecioMedio } from "@/data/products";
import { textoConMedio } from "@/lib/precio-medio-texto";

/**
 * Línea "$X con <Medio>" dentro de la card del catálogo, carruseles y favoritos (slot `installments`
 * de `ProductCard`, sin cambios en el DS). Color de acento y un peso más que las cuotas, que van
 * debajo. Sin medio → nada (ni línea vacía ni "$0").
 */
export function PrecioMedioCard({ medio }: { medio?: PrecioMedio | null }) {
  if (!medio) return null;
  return <span className="block text-[15px] font-bold leading-snug text-accent tabular-nums">{textoConMedio(medio)}</span>;
}
