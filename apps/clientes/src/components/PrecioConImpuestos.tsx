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

import type { PrecioMedio } from "@/data/products";
import { fmtPrecio as fmt } from "@/lib/format";
import { textoConMedio } from "@/components/PrecioMedio";

interface Props {
  /** Precio neto (sin IVA) de la lista del visitante. */
  price: number;
  /** Precio final con IVA. undefined = sin IVA conocido. */
  precioFinal?: number;
  /** Precio de lista general (final si se conoce) para tachar. */
  precioLista?: number;
  /** Medios con lista propia más barata (ya filtrados y ordenados): una línea "$X con <Medio>" cada uno. */
  preciosMedios?: PrecioMedio[];
}

export function PrecioConImpuestos({ price, precioFinal, precioLista, preciosMedios }: Props) {
  // Con precio por medio, el protagonista es "$X con <Medio>" y el de lista baja de tamaño.
  const conMedios = Boolean(preciosMedios?.length);
  return (
    <div>
      {precioLista != null && (
        <p className="mb-1.5 text-[15px] text-muted tabular-nums">
          <span className="sr-only">Precio de lista: </span>
          <s>{fmt(precioLista)}</s>
        </p>
      )}
      <span
        className={
          conMedios
            ? "text-[20px] font-semibold leading-none text-text tabular-nums lg:text-[22px]"
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
            <li key={m.slug} className="font-display text-[28px] font-bold leading-tight tracking-tight text-accent tabular-nums lg:text-[32px]">
              {textoConMedio(m)}
            </li>
          ))}
        </ul>
      ) : null}
      {precioLista != null && (
        <p className="mt-2 text-[13px] font-semibold text-accent">Precio exclusivo para su cuenta</p>
      )}
    </div>
  );
}
