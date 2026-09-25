import { propsChatIa } from "@/lib/chat-ia";
import { ChatIa } from "./ChatIa";

/**
 * Hueco del layout (server, dentro de `<Suspense fallback={null}>`): el flag
 * `chat-ia` se evalúa por request, fuera del shell estático. Sin flag o sin
 * config de ai-api es null y no se monta nada. Detrás del gate "Próximamente"
 * tampoco aparece: el proxy responde el gate antes de llegar al layout.
 */
export async function ChatIaServidor() {
  const chat = await propsChatIa();
  return chat ? <ChatIa {...chat} /> : null;
}
