"use client";

import { useChatIa } from "@/hooks/useChatIa";
import { ETIQUETA_BOTON_ASISTENTE } from "@/lib/chat-ia-textos";

/**
 * Botón del asistente dentro del buscador del header (al lado de la lupa), en
 * el header completo y en la barra compacta. Es la entrada al chat: el widget
 * no dibuja burbuja (`launcher={false}`). Abre y cierra (`aria-expanded`); el
 * chat también se cierra con su X o Escape. Sin chat montado (flag `chat-ia`
 * apagado, servidor, primer render) no se dibuja: nunca queda un botón que no
 * hace nada.
 */
export function BotonAsistente() {
  const { disponible, abierto, alternar } = useChatIa();
  if (!disponible) return null;
  return (
    <button
      type="button"
      onClick={() => alternar()}
      aria-expanded={abierto}
      aria-label={ETIQUETA_BOTON_ASISTENTE}
      title={ETIQUETA_BOTON_ASISTENTE}
      className={`flex shrink-0 items-center px-3.5 transition-colors hover:text-primary ${abierto ? "text-primary" : "text-muted"}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    </button>
  );
}
