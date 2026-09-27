/**
 * Precio final con IVA + "precio sin impuestos nacionales" (Ley 27.743 /
 * Res. 4/2025).
 *
 * No depende del flag `cuotas`. Sin `precioFinal` (producto sin IVA conocido)
 * se muestra el precio como siempre y no se inventa ningún neto.
 *
 * Va sólo en la ficha del producto: en la card del catálogo el precio lo dibuja
 * `ProductCard` de @myd-org/ui sin el neto.
 *
 * Con `precioLista` (cliente con lista propia más barata) el de lista va
 * tachado arriba y abajo el aviso de que es el precio de su cuenta.
 */

import { fmtMonto as fmt } from "@/lib/cuotas-textos";

interface Props {
  /** Precio neto (sin IVA) de la lista del visitante. */
  price: number;
  /** Precio final con IVA. undefined = sin IVA conocido. */
  precioFinal?: number;
  /** Precio de lista general (final si se conoce) para tachar. */
  precioLista?: number;
}

export function PrecioConImpuestos({ price, precioFinal, precioLista }: Props) {
  return (
    <div>
      {precioLista != null && (
        <p className="mb-1.5 text-[15px] text-muted tabular-nums">
          <span className="sr-only">Precio de lista: </span>
          <s>{fmt(precioLista)}</s>
        </p>
      )}
      <span className="font-display text-[34px] font-bold leading-none tracking-tight text-text tabular-nums lg:text-[38px]">{fmt(precioFinal ?? price)}</span>
      {precioFinal != null && (
        <p className="mt-2 text-[13px] text-muted">
          precio sin impuestos nacionales {fmt(price)}
        </p>
      )}
      {precioLista != null && (
        <p className="mt-2 text-[13px] font-semibold text-accent">Precio exclusivo para su cuenta</p>
      )}
    </div>
  );
}
