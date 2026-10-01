"use client";

import { Button, EmptyState } from "@myd-org/ui";
import { useChatIa } from "@/hooks/useChatIa";
import { TEXTOS_FRANJA, TEXTOS_SIN_RESULTADOS } from "@/lib/busqueda-inteligente/textos";
import type { ChipSugerido } from "@/lib/busqueda-inteligente/url";
import { ChipSumar } from "./FranjaBusqueda";
import { ConversarIcon } from "./iconos";
import Link from "next/link";
import { track } from "@/lib/tracking/track";

/**
 * "Sin resultados" con salida (búsqueda inteligente, flag `busqueda-ia`):
 * nunca deja al visitante sin por dónde seguir.
 *
 * - Alternativas: lo que la interpretación sugirió, como chips-link (quitan la
 *   búsqueda y aplican ese filtro).
 * - Si la URL vino de interpretar, "Ver resultados de «consulta» tal cual".
 * - Si la búsqueda no pasó por `/buscar` (clásica), "Ver productos
 *   relacionados": la entiende la búsqueda v2.
 * - Si hay chat: "¿Quiere que un asesor le ayude a elegir? · Conversar", que
 *   abre el chat con la consulta como primer mensaje.
 * - Siempre, "Ver todos los productos".
 */
export function CatalogoSinResultados({
  consulta,
  alternativas,
  talCualHref,
  relacionadosHref,
  verTodos,
}: {
  consulta: string;
  alternativas: ChipSugerido[];
  talCualHref?: string;
  relacionadosHref?: string;
  verTodos: () => void;
}) {
  const chat = useChatIa();
  return (
    <EmptyState
      title={TEXTOS_SIN_RESULTADOS.titulo(consulta)}
      description={alternativas.length ? TEXTOS_SIN_RESULTADOS.conAlternativas : TEXTOS_SIN_RESULTADOS.sinAlternativas}
      action={
        <div className="flex flex-col items-center gap-5">
          {alternativas.length > 0 && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm font-medium text-muted">{TEXTOS_SIN_RESULTADOS.alternativas}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {alternativas.map((c) => (
                  <ChipSumar key={c.clave} chip={c} />
                ))}
              </div>
            </div>
          )}
          {relacionadosHref && (
            <Link href={relacionadosHref} prefetch={false} className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
              {TEXTOS_SIN_RESULTADOS.relacionados}
            </Link>
          )}
          {talCualHref && (
            <Link href={talCualHref} prefetch={false} className="text-sm font-medium text-accent underline-offset-4 hover:underline">
              {TEXTOS_FRANJA.talCual(consulta)}
            </Link>
          )}
          {chat.disponible && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 sm:flex-row sm:gap-3">
              <p className="text-sm text-text">{TEXTOS_SIN_RESULTADOS.asesor}</p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  track({ tipo: "busqueda_conversar", origen: "sin_resultados" });
                  chat.conversar(consulta);
                }}
              >
                <ConversarIcon className="shrink-0" />
                {TEXTOS_SIN_RESULTADOS.conversar}
              </Button>
            </div>
          )}
          <Button variant="secondary" onClick={verTodos}>
            {TEXTOS_SIN_RESULTADOS.verTodos}
          </Button>
        </div>
      }
    />
  );
}
