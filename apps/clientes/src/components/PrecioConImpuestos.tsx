/**
 * Precio final con IVA + "precio sin impuestos nacionales" (Ley 27.743 /
 * Res. 4/2025).
 *
 * No depende del flag `cuotas`. Sin `precioFinal` (producto sin IVA conocido)
 * se muestra el precio como siempre y no se inventa ningún neto.
 *
 * Va sólo en la ficha del producto: en la card del catálogo el precio lo dibuja
 * `ProductCard` de @myd-org/ui sin el neto.
 */

import type { PrecioMedio } from "@/data/products";
import { fmtPrecio as fmt } from "@/lib/format";
import { textoConMedio } from "@/components/PrecioMedio";

interface Props {
  /** Precio neto (sin IVA) de la lista del visitante. */
  price: number;
  /** Precio final con IVA. undefined = sin IVA conocido. */
  precioFinal?: number;
  /** Medios con lista propia más barata (ya filtrados y ordenados): una línea "$X con <Medio>" cada uno. */
  preciosMedios?: PrecioMedio[];
}

export function PrecioConImpuestos({ price, precioFinal, preciosMedios }: Props) {
  // Con precio por medio, el protagonista es "$X con <Medio>" y el de lista baja de tamaño.
  const conMedios = Boolean(preciosMedios?.length);
  return (
    <div>
      <span
        className={
          conMedios
            ? "text-[18px] font-semibold leading-none text-text tabular-nums"
            : "font-display text-[34px] font-bold leading-none tracking-tight text-text tabular-nums lg:text-[38px]"
        }
      >
        {fmt(precioFinal ?? price)}
      </span>
      {precioFinal != null && (
        <p className="mt-2 text-[13px] text-muted">
          precio sin impuestos nacionales {fmt(price)}
        </p>
      )}
      {conMedios ? (
        <ul className="mt-4 space-y-1.5">
          {preciosMedios!.map((m) => (
            <li key={m.slug} className="font-display text-[22px] font-bold leading-tight tracking-tight text-accent tabular-nums lg:text-[24px]">
              {textoConMedio(m)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
