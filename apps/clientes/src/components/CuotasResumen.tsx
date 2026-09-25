import { Progress } from "@myd-org/ui";
import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import type { ResumenCuotas } from "@/lib/cuotas-exhibicion";

/**
 * Bloque de cuotas del carrito ("Hasta N cuotas…" + "Le faltan $X…" con barra)
 * y del checkout (plan del pedido, sin escalón). null → nada.
 */
export function CuotasResumen({
  resumen,
  titulo,
  className = "",
}: {
  resumen: ResumenCuotas | null;
  /** Encabezado opcional (checkout). */
  titulo?: string;
  className?: string;
}) {
  if (!resumen) return null;
  const { mejor, escalon } = resumen;

  return (
    <div className={`rounded-lg border border-border bg-elevated/50 p-3 ${className}`} aria-live="polite">
      {titulo && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{titulo}</p>}
      {resumen.titulo && (
        <p className={`text-sm font-bold ${mejor?.sinInteres ? "text-success" : "text-text"}`}>
          {resumen.titulo}
        </p>
      )}
      {mejor && (
        <p className="text-xs text-muted">
          {TEXTOS_CUOTAS.linea(mejor.cuotas, mejor.montoCuota, mejor.sinInteres)}
        </p>
      )}
      {escalon && (
        <div className={resumen.titulo ? "mt-3" : ""}>
          <p className="mb-1.5 text-xs font-medium text-text">{escalon.texto}</p>
          <Progress
            value={escalon.progresoPct}
            max={100}
            size="sm"
            tone="success"
            aria-label={TEXTOS_CUOTAS.progresoEscalon}
            aria-valuetext={escalon.texto}
          />
        </div>
      )}
    </div>
  );
}
