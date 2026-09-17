/**
 * Precio final con IVA + "PRECIO SIN IMPUESTOS NACIONALES" (Ley 27.743 /
 * Res. 4/2025).
 *
 * No depende de CUOTAS_ENABLED. Sin `precioFinal` (producto sin IVA conocido)
 * se muestra el precio como siempre y no se inventa ningún neto.
 *
 * Variantes:
 * - `ficha` (default): final grande + neto chico, sobre la card oscura de la ficha.
 * - `nota`: sólo la línea del neto. Para la card del catálogo, donde el precio
 *   principal lo dibuja `ProductCard` de @myd-org/ui (que todavía no tiene slot
 *   `priceNote`).
 */

import { fmtMonto as fmt } from "@/lib/cuotas-textos";

interface Props {
  /** Precio neto (sin IVA) de la lista del visitante. */
  price: number;
  /** Precio final con IVA. undefined = sin IVA conocido. */
  precioFinal?: number;
  variante?: "ficha" | "nota";
}

export function PrecioConImpuestos({ price, precioFinal, variante = "ficha" }: Props) {
  if (variante === "nota") {
    if (precioFinal == null) return null;
    return (
      <p className="text-[11px] uppercase tracking-wide text-muted">
        PRECIO SIN IMPUESTOS NACIONALES {fmt(price)}
      </p>
    );
  }

  return (
    <div>
      <span className="text-4xl font-extrabold text-white">{fmt(precioFinal ?? price)}</span>
      {precioFinal != null && (
        <p className="mt-1 text-xs uppercase tracking-wide text-white/70">
          PRECIO SIN IMPUESTOS NACIONALES {fmt(price)}
        </p>
      )}
    </div>
  );
}
