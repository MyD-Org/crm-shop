import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import type { CuotaNoAlcanzada, OpcionCuotas } from "@/lib/cuotas-sin-interes";
import { fmtPrecio } from "@/lib/format";

/**
 * Contenido del modal "Ver medios de pago": UN bloque "Tarjeta de crédito o débito" con 1 pago
 * (precio contado) y una fila por cada cantidad de cuotas SIN INTERÉS ofrecida por cualquiera de los
 * medios (ya combinadas con `opcionesCombinadas`). No nombra al procesador: eso queda para el checkout.
 *
 * Separado del diálogo para poder testearlo con render estático.
 */
export function MediosDePagoDetalle({
  opciones,
  precioContado,
  noAlcanzadas = [],
}: {
  opciones: OpcionCuotas[];
  precioContado: number;
  /** Cantidades que el producto no alcanza por mínimo: filas secundarias, sin monto por cuota. */
  noAlcanzadas?: CuotaNoAlcanzada[];
}) {
  return (
    <div className="space-y-5">
      <section aria-labelledby="medio-cuotas">
        <h3 id="medio-cuotas" className="mb-2 text-sm font-bold text-text">
          {TEXTOS_CUOTAS.tituloTarjeta}
        </h3>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          <li className="flex items-center justify-between gap-4 px-3 py-2.5">
            <span className="text-sm text-text">
              {TEXTOS_CUOTAS.unPago}
              <span className="block text-xs text-muted">{TEXTOS_CUOTAS.precioContado}</span>
            </span>
            <span className="text-sm font-semibold text-text">{fmtPrecio(precioContado)}</span>
          </li>
          {opciones.map((o) => (
            <li key={o.cuotas} className="flex items-start justify-between gap-4 px-3 py-2.5">
              <span className="text-sm text-text">
                {TEXTOS_CUOTAS.filaCuotas(o.cuotas, o.montoCuota)}
                <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                  {TEXTOS_CUOTAS.sinInteres}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs text-muted">
                {TEXTOS_CUOTAS.total}
                <span className="block text-sm font-semibold text-text">{fmtPrecio(o.total)}</span>
              </span>
            </li>
          ))}
          {noAlcanzadas.map((n) => (
            <li key={`min-${n.cuotas}`} data-no-alcanzada className="px-3 py-2.5 text-xs text-muted">
              {TEXTOS_CUOTAS.filaNoAlcanzada(n.cuotas, n.minimo)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
