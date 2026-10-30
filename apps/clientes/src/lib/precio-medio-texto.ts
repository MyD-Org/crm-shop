/** Texto "$X con <Medio>": lo comparten la card del catálogo, la ficha y la card del chat. */
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
