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
 * Selector de cuotas del checkout: una fila del radio del DS por opción ("1 pago" / "N cuotas de $X",
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
      <p className="text-xs text-muted">{TEXTOS_CUOTAS.soloCredito}</p>
      {meta && !meta.alcanzada && <MetasCarrito metas={[meta]} compacta />}
    </div>
  );
}
