import { CuotasLeyenda } from "@/components/CuotasLeyenda";
import { CuotasLinea } from "@/components/CuotasLinea";
import type { OpcionCuotas } from "@/lib/pagos/cuotas-tipos";

/**
 * Cuotas bajo la card del catálogo / home: a lo sumo una línea con la mejor
 * opción + leyenda corta. Sin opción → nada.
 *
 * Vive fuera de `ProductCard` hasta que @myd-org/ui tenga el slot `installments`
 * (tarea 7.1), igual que la nota de precio sin impuestos.
 */
export function CuotasCard({ opcion }: { opcion: OpcionCuotas | null }) {
  if (!opcion) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
      <CuotasLinea opcion={opcion} />
      <CuotasLeyenda corta />
    </div>
  );
}
