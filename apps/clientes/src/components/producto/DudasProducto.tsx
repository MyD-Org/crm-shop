"use client";

import { useMemo } from "react";
import { ConversarIcon } from "@/components/catalogo/iconos";
import { useChatIa } from "@/hooks/useChatIa";
import { preguntasSugeridas, type ProductoParaPreguntas } from "@/lib/iniciativa/preguntas-producto";
import { TEXTOS_DUDAS_PRODUCTO } from "@/lib/iniciativa/textos";

/**
 * "¿Dudas sobre este producto?" en la columna de compra de la ficha (spec
 * catálogo asistido fase 2, §3): tres preguntas sugeridas por reglas
 * (src/lib/iniciativa/preguntas-producto.ts) que abren el chat con esa
 * pregunta. El contexto de pantalla ya lleva el producto.
 *
 * Solo con el chat montado (bridge `disponible`): en el servidor y sin chat no
 * se dibuja nada, así que nunca queda un botón que no hace nada. Nada gasta
 * tokens hasta que el visitante toca una pregunta.
 */
export function DudasProducto({ producto }: { producto: ProductoParaPreguntas }) {
  const { disponible, conversar } = useChatIa();
  const { name, description, category } = producto;
  const preguntas = useMemo(() => preguntasSugeridas({ name, description, category }), [name, description, category]);
  if (!disponible) return null;

  return (
    <section
      aria-labelledby="dudas-producto-titulo"
      className="space-y-3 rounded-2xl border border-border bg-elevated p-4 motion-safe:animate-aparecer"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ConversarIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 id="dudas-producto-titulo" className="font-display text-base font-semibold text-text">
            {TEXTOS_DUDAS_PRODUCTO.titulo}
          </h2>
          <p className="text-sm text-muted">{TEXTOS_DUDAS_PRODUCTO.bajada}</p>
        </div>
      </div>
      <ul aria-label={TEXTOS_DUDAS_PRODUCTO.region} className="flex flex-wrap gap-2">
        {preguntas.map((pregunta) => (
          <li key={pregunta} className="min-w-0 max-w-full">
            <button
              type="button"
              onClick={() => conversar(pregunta)}
              aria-label={TEXTOS_DUDAS_PRODUCTO.preguntar(pregunta)}
              className="max-w-full rounded-full border border-border bg-surface px-3 py-1.5 text-left text-sm font-medium text-text transition-colors hover:border-primary hover:text-primary focus-visible:border-primary"
            >
              {pregunta}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
