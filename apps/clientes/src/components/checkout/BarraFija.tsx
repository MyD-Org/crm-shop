import type { ReactNode } from "react";
import { fmtPrecio } from "@/lib/format";

/**
 * Pie de cada paso del checkout. En el celular queda fijo abajo, en una sola fila: total a la
 * izquierda y el botón que sigue a la derecha, siempre a mano. Desde `lg` vuelve a su lugar, al
 * pie de la sección, y el total se esconde (ya está en el resumen).
 */
export function BarraFija({
  total,
  ahorro,
  error,
  nota,
  children,
}: {
  /** Total del pedido; sin cotización todavía, no se muestra (nada de "$ 0,00"). */
  total?: number;
  /** "Ahorra $X" bajo el total (paso Pago). */
  ahorro?: number | null;
  error?: string | null;
  /** Texto chico bajo la fila (por qué no se puede confirmar, cómo se cobra). */
  nota?: string | null;
  /** El botón principal. */
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.25)] lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
      {error && <p className="mb-2 rounded-lg bg-danger/5 p-2 text-xs text-danger lg:mb-3 lg:p-3">{error}</p>}
      <div className="flex items-center gap-4">
        {total !== undefined && (
          <div className="min-w-0 shrink-0 lg:hidden">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Total</p>
            <p className="font-display text-lg font-semibold leading-tight text-text tabular-nums">{fmtPrecio(total)}</p>
            {!!ahorro && ahorro > 0 && <p className="text-[11px] font-bold text-success">Ahorra {fmtPrecio(ahorro)}</p>}
          </div>
        )}
        <div className="flex flex-1 justify-end">{children}</div>
      </div>
      {nota && <p className="mt-1.5 text-center text-[11px] leading-snug text-muted lg:mt-2 lg:text-right lg:text-xs">{nota}</p>}
    </div>
  );
}
