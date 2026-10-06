import { Progress } from "@myd-org/ui";
import type { MetaCarrito } from "@/lib/metas-carrito";

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * Bloque de metas del carrito (envío gratis, más cuotas sin interés): una barra por meta, apiladas en
 * el MISMO recuadro y ya ordenadas (la más cercana primero). Sin metas no se dibuja nada.
 */
export function MetasCarrito({ metas }: { metas: MetaCarrito[] }) {
  if (metas.length === 0) return null;
  return (
    <div className="space-y-4 rounded-2xl bg-bg p-4" aria-live="polite">
      {metas.map((m) => (
        <div key={m.id} className="space-y-2.5" data-meta={m.id}>
          <p className="flex items-center gap-2 text-sm font-bold text-text">
            <span
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-white transition-[scale,opacity] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
                m.alcanzada ? "scale-100 opacity-100" : "scale-[0.6] opacity-0"
              }`}
              aria-hidden="true"
            >
              <CheckIcon />
            </span>
            {m.texto}
          </p>
          <Progress value={m.pct} aria-label={m.aria} tone="success" />
        </div>
      ))}
    </div>
  );
}
