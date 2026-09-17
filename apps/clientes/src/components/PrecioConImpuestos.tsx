/**
 * Precio final con IVA + "precio sin impuestos nacionales" (Ley 27.743 /
 * Res. 4/2025).
 *
 * No depende de CUOTAS_ENABLED. Sin `precioFinal` (producto sin IVA conocido)
 * se muestra el precio como siempre y no se inventa ningún neto.
 *
 * Va sólo en la ficha del producto: en la card del catálogo el precio lo dibuja
 * `ProductCard` de @myd-org/ui sin el neto.
 */

import { fmtMonto as fmt } from "@/lib/cuotas-textos";

interface Props {
  /** Precio neto (sin IVA) de la lista del visitante. */
  price: number;
  /** Precio final con IVA. undefined = sin IVA conocido. */
  precioFinal?: number;
}

export function PrecioConImpuestos({ price, precioFinal }: Props) {
  return (
    <div>
      <span className="text-4xl font-extrabold text-white">{fmt(precioFinal ?? price)}</span>
      {precioFinal != null && (
        <p className="mt-1 text-xs tracking-wide text-white/70">
          precio sin impuestos nacionales {fmt(price)}
        </p>
      )}
    </div>
  );
}
