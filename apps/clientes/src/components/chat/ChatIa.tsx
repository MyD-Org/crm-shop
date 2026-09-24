"use client";

import dynamic from "next/dynamic";
import type { PropsChatIa } from "@/lib/chat-ia";

/**
 * Burbuja del chat con el agente. El layout sólo la monta con el flag
 * `chat-ia` prendido (ver src/lib/chat-ia.ts). El widget se carga aparte y
 * sólo en el navegador: no suma nada al HTML ni al bundle de las páginas
 * mientras el chat esté apagado.
 */
const ChatIaWidget = dynamic(() => import("./ChatIaWidget"), { ssr: false });

export function ChatIa(props: PropsChatIa) {
  return <ChatIaWidget {...props} />;
}
