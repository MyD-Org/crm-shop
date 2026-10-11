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
        <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
        <path d="M20 3v4" />
        <path d="M22 5h-4" />
        <path d="M4 17v2" />
        <path d="M5 18H3" />
      </svg>
    </button>
  );
}
