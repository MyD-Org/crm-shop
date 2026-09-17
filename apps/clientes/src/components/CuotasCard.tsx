import { CuotasLinea } from "@/components/CuotasLinea";
import type { OpcionCuotas } from "@/lib/pagos/cuotas-tipos";

/**
 * Cuotas dentro de la card del catálogo / home: a lo sumo una línea con la
 * mejor opción. Sin opción → nada.
 *
 * Va en el slot `installments` de `ProductCard` (@myd-org/ui ≥ 0.10.0), debajo
 * del precio: chica y secundaria, para no competir con el precio.
 */
export function CuotasCard({ opcion }: { opcion: OpcionCuotas | null }) {
  if (!opcion) return null;
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <CuotasLinea opcion={opcion} tamano="sm" />
    </span>
  );
}
