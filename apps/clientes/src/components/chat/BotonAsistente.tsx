"use client";

import { useChatIa } from "@/hooks/useChatIa";
import { ETIQUETA_BOTON_ASISTENTE } from "@/lib/chat-ia-textos";

/**
 * Botón "Asistente" del header, al lado del buscador (en el header completo y
 * en la barra compacta fija al scrollear). Es la entrada al chat: el widget no
 * dibuja burbuja (`launcher={false}`). Abre y cierra (`aria-expanded`); el chat
 * también se cierra con su X o Escape. Sin chat montado (flag `chat-ia`
 * apagado, servidor, primer render) no se dibuja: nunca queda un botón que no
 * hace nada. `compacto`: sólo el ícono (barra compacta del header, angosta);
 * el texto queda como nombre accesible.
 */
export function BotonAsistente({ compacto = false }: { compacto?: boolean }) {
  const { disponible, abierto, alternar } = useChatIa();
  if (!disponible) return null;
  return (
    <button
      type="button"
      onClick={() => alternar()}
      aria-expanded={abierto}
      className={`flex h-10 shrink-0 items-center gap-2 rounded-full border border-primary text-sm font-semibold transition-colors ${
        compacto ? "w-10 justify-center" : "px-3.5 max-sm:w-10 max-sm:justify-center max-sm:px-0"
      } ${
        abierto ? "bg-primary text-on-primary" : "bg-surface text-primary hover:bg-primary hover:text-on-primary"
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
      <span className={compacto ? "sr-only" : "max-sm:sr-only"}>{ETIQUETA_BOTON_ASISTENTE}</span>
    </button>
  );
}
