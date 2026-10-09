import type { PrecioMedio } from "@/data/products";
import { fmtPrecio } from "@/lib/format";
import type { OpcionCobro } from "@/lib/pagos/opciones-cobro";

/** Cómo se nombra cada forma de pago en "$X con <forma>". */
const ROTULO_FORMA: Record<OpcionCobro, string> = {
  credito: "crédito",
  debito: "débito",
  cuenta_mp: "dinero en cuenta de Mercado Pago",
};

/**
 * "$ 90.000,00 con Transferencia": con IVA si se conoce, igual que el precio de la card. Si el precio
 * es de una forma de pago (lista propia de crédito, débito o cuenta MP), se rotula con la forma:
 * "$ 90.000,00 con débito".
 */
export function textoConMedio(m: PrecioMedio): string {
  return `${fmtPrecio(m.precioFinal ?? m.price)} con ${m.forma ? ROTULO_FORMA[m.forma] : m.nombre}`;
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
