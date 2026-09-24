/**
 * Lo que el layout necesita para montar el chat. SOLO servidor.
 *
 * `null` = no hay chat (flag `chat-ia` apagado o sin config de ai-api): el
 * layout no renderiza nada y no sale ningún pedido a ai-api. Con chat, sólo
 * datos públicos: el id del agente y el título (nombre del tenant). La API key
 * nunca llega al navegador.
 */
import { aiApiConfig } from "./ai-api-config";
import { chatIaHabilitado } from "./chat-ia-flag";
import { datosTenant } from "./cuenta-corriente/tenant-cc";

export interface PropsChatIa {
  agentId: string;
  titulo: string;
}

/** Título si no se puede leer el nombre del tenant. */
export const TITULO_CHAT_POR_DEFECTO = "Asistente";

export async function propsChatIa(): Promise<PropsChatIa | null> {
  const config = aiApiConfig();
  if (!config || !(await chatIaHabilitado())) return null;
  const tenant = await datosTenant().catch((err: unknown) => {
    console.error(`[chat-ia] no se pudo leer el tenant: ${err instanceof Error ? err.name : "desconocido"}`);
    return null;
  });
  return { agentId: config.agentId, titulo: tenant?.nombre || TITULO_CHAT_POR_DEFECTO };
}
