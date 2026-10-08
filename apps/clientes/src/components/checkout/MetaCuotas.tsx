import { MetasCarrito } from "@/components/carrito/MetasCarrito";
import type { ProgresoCuotas } from "@/lib/cuotas-sin-interes";
import { metaCuotas } from "@/lib/metas-carrito";

/**
 * Sólo la meta compacta "Sume $X más y pague en N cuotas sin interés." (si falta para el próximo
 * escalón). Las cuotas se eligen en el formulario de pago de cada procesador (`SelectorCuotas`).
 */
export function MetaCuotas({ progreso }: { progreso?: ProgresoCuotas | null }) {
  const meta = metaCuotas(progreso);
  if (!meta || meta.alcanzada) return null;
  return (
    <div className="mt-4">
      <MetasCarrito metas={[meta]} compacta />
    </div>
  );
}
