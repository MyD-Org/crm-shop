import { CuotasLeyenda } from "@/components/CuotasLeyenda";
import { fmtMonto, TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import type { BloqueMedio } from "@/lib/cuotas-exhibicion";

/**
 * Contenido del modal "Ver medios de pago": un bloque por medio con 1 pago
 * (precio contado) y cada opción de cuotas con valor de cuota y total. Con
 * interés: CFT destacado y TEA secundaria. Sin interés: sin recargo, sin CFT.
 *
 * Separado del diálogo para poder testearlo con render estático.
 */
export function MediosDePagoDetalle({ bloques }: { bloques: BloqueMedio[] }) {
  return (
    <div className="space-y-5">
      {bloques.map((b) => (
        <section key={b.codigo} aria-labelledby={`medio-${b.codigo}`}>
          <h3 id={`medio-${b.codigo}`} className="mb-2 text-sm font-bold text-text">
            {b.nombre}
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            <li className="flex items-center justify-between gap-4 px-3 py-2.5">
              <span className="text-sm text-text">
                {TEXTOS_CUOTAS.unPago}
                <span className="block text-xs text-muted">{TEXTOS_CUOTAS.precioContado}</span>
              </span>
              <span className="text-sm font-semibold text-text">{fmtMonto(b.precioContado)}</span>
            </li>
            {b.opciones.map((o) => (
              <li key={o.cuotas} className="flex items-start justify-between gap-4 px-3 py-2.5">
                <span className="text-sm text-text">
                  {TEXTOS_CUOTAS.filaCuotas(o.cuotas, o.montoCuota)}
                  {o.sinInteres ? (
                    <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                      {TEXTOS_CUOTAS.sinInteres}
                    </span>
                  ) : (
                    (o.cftPct !== null || o.teaPct !== null) && (
                      <span className="mt-0.5 block">
                        {o.cftPct !== null && (
                          <span className="text-sm font-bold text-text">{TEXTOS_CUOTAS.cft(o.cftPct)}</span>
                        )}
                        {o.teaPct !== null && (
                          <span className="ml-2 text-xs text-muted">{TEXTOS_CUOTAS.tea(o.teaPct)}</span>
                        )}
                      </span>
                    )
                  )}
                </span>
                <span className="shrink-0 text-right text-xs text-muted">
                  {TEXTOS_CUOTAS.total}
                  <span className="block text-sm font-semibold text-text">{fmtMonto(o.total)}</span>
                </span>
              </li>
            ))}
          </ul>
          {b.opciones.length === 0 && (
            <p className="mt-1.5 text-xs text-muted">{TEXTOS_CUOTAS.sinOpcionesMedio}</p>
          )}
        </section>
      ))}
      <CuotasLeyenda />
    </div>
  );
}
