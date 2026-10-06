import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import type { OpcionCuotas } from "@/lib/cuotas-sin-interes";
import { fmtPrecio } from "@/lib/format";

/**
 * Contenido del modal "Ver medios de pago": un bloque con el medio que cobra en cuotas ("Tarjetas
 * de crédito (Mercado Pago)"), con 1 pago (precio contado) y cada cantidad de cuotas SIN INTERÉS con
 * el valor de la cuota y el total de la lista de esa cantidad.
 *
 * Separado del diálogo para poder testearlo con render estático.
 */
export function MediosDePagoDetalle({
  medio,
  precioContado,
  opciones,
}: {
  /** Nombre del medio ("Mercado Pago"). */
  medio: string;
  precioContado: number;
  opciones: OpcionCuotas[];
}) {
  return (
    <div className="space-y-5">
      <section aria-labelledby="medio-cuotas">
        <h3 id="medio-cuotas" className="mb-2 text-sm font-bold text-text">
          {TEXTOS_CUOTAS.tituloMedio(medio)}
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
                {TEXTOS_CUOTAS.filaCuotas(o.cuotas, o.montoCuota, o.primeraCuota)}
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
        </ul>
      </section>
    </div>
  );
}
