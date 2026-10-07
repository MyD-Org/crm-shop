"use client";

import Link from "next/link";
import { Button } from "@myd-org/ui";
import { useChatIa } from "@/hooks/useChatIa";
import { TEXTOS_SIN_RESULTADOS } from "@/lib/busqueda-inteligente/textos";
import type { ChipSugerido } from "@/lib/busqueda-inteligente/url";
import { track } from "@/lib/tracking/track";
import type { OrigenConversar } from "@/lib/tracking/eventos";
import { ConversarIcon, MasIcon } from "./iconos";

/**
 * Piezas de la búsqueda inteligente que usa el "sin resultados": el chip que suma
 * un filtro sugerido y el botón "Conversar". La franja "Entendimos" se retiró: lo
 * buscado y lo entendido quedan como chips removibles arriba de la grilla
 * (CatalogoChips), igual que el resto de los filtros.
 */
/** Chip que SUMA un filtro: un link (se abre en otra pestaña, se comparte, vuelve con atrás). */
function ChipSumar({ chip }: { chip: ChipSugerido }) {
  return (
    <Link
      href={chip.href}
      prefetch={false}
      className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 py-1 text-sm font-medium text-text transition-colors hover:border-primary hover:bg-elevated"
    >
      <MasIcon className="shrink-0 text-muted" />
      {chip.etiqueta}
    </Link>
  );
}

/** "Conversar": abre el chat con la consulta como primer mensaje. Sin chat, nada. */
function BotonConversar({ consulta, origen = "franja" }: { consulta: string; origen?: OrigenConversar }) {
  const chat = useChatIa();
  if (!chat.disponible) return null;
  return (
    <Button
      variant="link"
      size="inline"
      onClick={() => {
        track({ tipo: "busqueda_conversar", origen });
        chat.conversar(consulta);
      }}
    >
      <ConversarIcon className="shrink-0" />
      {TEXTOS_SIN_RESULTADOS.conversar}
    </Button>
  );
}

export { ChipSumar, BotonConversar };
