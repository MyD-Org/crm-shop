import { RadioGroup } from "@myd-org/ui";
import { MetasCarrito } from "@/components/carrito/MetasCarrito";
import type { ProgresoCuotas } from "@/lib/cuotas-sin-interes";
import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import { metaCuotas } from "@/lib/metas-carrito";

export interface OpcionCuotas {
  cuotas: number;
  total: number;
  montoCuota: number;
}

/**
 * Sólo la meta compacta "Sume $X más y pague en N cuotas sin interés." (si falta para el próximo
 * escalón). Con Mercado Pago las cuotas se eligen en el formulario de pago (`SelectorCuotas`).
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

/**
 * Selector de cuotas del checkout antes de crear el pedido (Payway, hasta que elija las cuotas en su
 * formulario): una fila del radio del DS por opción ("1 pago" / "N cuotas de $X",
 * etiqueta "Sin interés" en las de más de un pago y el total debajo) y, si falta para el próximo
 * escalón, la meta compacta del carrito.
 */
export function OpcionesCuotas({
  opciones,
  elegida,
  onElegir,
  deshabilitado,
  progreso,
}: {
  opciones: OpcionCuotas[];
  elegida: number;
  onElegir: (cuotas: number) => void;
  deshabilitado?: boolean;
  progreso?: ProgresoCuotas | null;
}) {
  const meta = metaCuotas(progreso);
  return (
    <div className="mt-4 space-y-3">
      <RadioGroup
        legend={TEXTOS_CUOTAS.checkoutTitulo}
        name="cuotas"
        value={String(elegida)}
        disabled={deshabilitado}
        onValueChange={(v) => onElegir(Number(v))}
        options={opciones.map((o) => ({
          value: String(o.cuotas),
          label: TEXTOS_CUOTAS.checkoutOpcion(o.cuotas, o.montoCuota),
          description: TEXTOS_CUOTAS.checkoutTotal(o.total),
          ...(o.cuotas > 1 ? { badge: { label: TEXTOS_CUOTAS.sinInteres, tone: "success" as const } } : {}),
        }))}
      />
      {/* Sólo con cuotas: en 1 pago también sirve el débito y el aviso confundía. */}
      {elegida > 1 && <p className="text-xs text-muted">{TEXTOS_CUOTAS.soloCredito}</p>}
      {meta && !meta.alcanzada && <MetasCarrito metas={[meta]} compacta />}
    </div>
  );
}
