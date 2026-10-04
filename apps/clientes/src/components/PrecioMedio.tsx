import type { PrecioMedio } from "@/data/products";
import { fmtPrecio } from "@/lib/format";

/** "$ 90.000,00 con Transferencia": con IVA si se conoce, igual que el precio de la card. */
export function textoConMedio(m: PrecioMedio): string {
  return `${fmtPrecio(m.precioFinal ?? m.price)} con ${m.nombre}`;
}

/**
 * Línea "$X con <Medio>" dentro de la card del catálogo, carruseles y favoritos (slot `installments`
 * de `ProductCard`, sin cambios en el DS). Color de acento y un peso más que las cuotas, que van
 * debajo. Sin medio → nada (ni línea vacía ni "$0").
 */
export function PrecioMedioCard({ medio }: { medio?: PrecioMedio | null }) {
  if (!medio) return null;
  return <span className="block text-[15px] font-bold leading-snug text-accent tabular-nums">{textoConMedio(medio)}</span>;
}
