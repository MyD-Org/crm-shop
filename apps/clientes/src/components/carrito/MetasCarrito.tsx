import { Progress } from "@myd-org/ui";
import type { MetaCarrito } from "@/lib/metas-carrito";
import { TextoConEnfasis } from "./TextoConEnfasis";

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
 * `compacta`: variante del checkout (menos aire y barra fina), con el mismo texto y énfasis.
 */
export function MetasCarrito({ metas, compacta = false }: { metas: MetaCarrito[]; compacta?: boolean }) {
  if (metas.length === 0) return null;
  return (
    <div className={`rounded-2xl bg-bg ${compacta ? "space-y-3 p-3" : "space-y-4 p-4"}`} aria-live="polite">
      {metas.map((m) => (
        <div key={m.id} className="space-y-2.5" data-meta={m.id}>
          <p className="flex items-center gap-2 text-sm font-medium text-text">
            <span
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-white transition-[scale,opacity] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
                m.alcanzada ? "scale-100 opacity-100" : "scale-[0.6] opacity-0"
              }`}
              aria-hidden="true"
            >
              <CheckIcon />
            </span>
            <span><TextoConEnfasis texto={m.texto} enfasis={m.enfasis} /></span>
          </p>
          <Progress value={m.pct} aria-label={m.aria} tone="success" size={compacta ? "sm" : undefined} />
        </div>
      ))}
    </div>
  );
}
