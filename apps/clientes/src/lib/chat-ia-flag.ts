/**
 * Flag del chat con el agente de IA. Se lee sólo en el server: al layout le
 * llega la config pública del widget (o nada), nunca el flag ni la API key.
 *
 * Apagado (default): no se renderiza el widget en ninguna página y
 * `POST /api/ai-token` responde 404, así que no sale ningún pedido a ai-api.
 * Prendido: burbuja del chat en todas las páginas del Shop. Con cliente
 * vinculado el agente puede consultar su cuenta; sin vínculo (anónimo o
 * logueado sin cuenta de cliente) sólo responde preventa.
 *
 * Además del flag hacen falta las envs de ai-api (ver ai-api-config.ts): sin
 * ellas no hay chat aunque el flag esté prendido.
 *
 * Vive en Vercel Flags (key `chat-ia`, ver src/flags.ts): se cambia sin redeploy.
 */
import { chatIaFlag } from "@/flags";
import { aiApiConfig } from "./ai-api-config";

export async function chatIaHabilitado(): Promise<boolean> {
  if (!aiApiConfig()) return false;
  return chatIaFlag();
}
