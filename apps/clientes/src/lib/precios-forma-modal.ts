/**
 * Precios por forma de pago del modal "Ver medios de pago". Lógica PURA, sin base ni flags.
 *
 * Sale de los mismos `preciosMedios` que arma la ficha (`armarPreciosMedios`), que solo trae una
 * línea por forma cuando los precios de las formas difieren. Una forma sin línea vale lo mismo que el
 * precio contado. Con más de un procesador con débito, se toma el menor precio de cada forma.
 */
import type { PrecioMedio } from "@/data/products";

export interface PreciosFormaModal {
  debito: number;
  credito: number;
}

const menor = (xs: number[]) => (xs.length > 0 ? Math.min(...xs) : null);

/**
 * `null` cuando el modal queda como siempre: sin listas por forma, o débito y crédito al mismo
 * precio. Si no, el precio de débito y el de crédito en 1 pago.
 */
export function preciosFormaDelModal(
  preciosMedios: readonly PrecioMedio[] | undefined,
  precioContado: number,
): PreciosFormaModal | null {
  if (!preciosMedios?.some((p) => p.forma === "debito")) return null;
  const deForma = (forma: string) =>
    preciosMedios.flatMap((p) => (p.forma === forma && p.precioFinal != null && p.precioFinal > 0 ? [p.precioFinal] : []));
  const debito = menor(deForma("debito")) ?? precioContado;
  const credito = menor(deForma("credito")) ?? precioContado;
  return debito === credito ? null : { debito, credito };
}
