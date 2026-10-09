/**
 * Lo que el layout necesita para montar el chat. SOLO servidor.
 *
 * `null` = no hay chat (flag `chat-ia` apagado o sin config de ai-api): el
 * layout no renderiza nada y no sale ningún pedido a ai-api. Con chat, sólo
 * datos públicos: el id del agente, el título (nombre del tenant) y los textos
 * del chat vacío que se editan en el admin del CRM. La API key nunca llega al
 * navegador.
 */
import { aiApiConfig } from "./ai-api-config";
import { identidadActual } from "./auth";
import { chatIaHabilitado } from "./chat-ia-flag";
import { datosTenant } from "./cuenta-corriente/tenant-cc";
import { textosChatTenant } from "./chat-ia-textos-tenant";

export interface PropsChatIa {
  agentId: string;
  titulo: string;
  /** Texto del chat vacío (admin del CRM o el de `chat-ia-textos.ts`). */
  textoVacio: string;
  /** Preguntas sugeridas del chat vacío (admin del CRM o las de `chat-ia-textos.ts`). */
  sugerencias: string[];
}

/** Título si no se puede leer el nombre del tenant. */
export const TITULO_CHAT_POR_DEFECTO = "Asistente";

export async function propsChatIa(): Promise<PropsChatIa | null> {
  const config = aiApiConfig();
  if (!config || !(await chatIaHabilitado())) return null;
  const [tenant, textos, agentId] = await Promise.all([
    datosTenant().catch((err: unknown) => {
      console.error(`[chat-ia] no se pudo leer el tenant: ${err instanceof Error ? err.name : "desconocido"}`);
      return null;
    }),
    textosChatTenant(),
    agenteSegunIdentidad(config),
  ]);
  return {
    agentId,
    titulo: tenant?.nombre || TITULO_CHAT_POR_DEFECTO,
    textoVacio: textos.emptyState,
    sugerencias: textos.suggestions,
  };
}

/**
 * El cliente vinculado chatea con su propio agente (modelo más capaz, tools de
 * cuenta) si está configurado. Sólo se lee la identidad cuando hay dos agentes:
 * con uno no cambia nada. El agente es un dato público; lo que protege la cuenta
 * es el `crm_token`, que sólo lleva la sesión del vinculado (ver chat-ia-sesion).
 */
async function agenteSegunIdentidad(config: { agentId: string; agentIdCliente?: string }): Promise<string> {
  if (!config.agentIdCliente) return config.agentId;
  const identidad = await identidadActual().catch(() => null);
  return identidad?.cliente?.codigocliente ? config.agentIdCliente : config.agentId;
}
