/**
 * Configuración de ai-api para el chat del Shop. SOLO servidor: `AI_API_KEY` es
 * un secreto y ningún componente `"use client"` importa este módulo.
 *
 * Sale de envs del proyecto del Shop y NO de `public.tenants`: el rol de runtime
 * del Shop no tiene (ni debe tener) GRANT sobre `ai_api_key`.
 *
 * - `AI_API_URL`: base de ai-api (http/https, sin barra final). La usan el
 *   rewrite `/ai-api/*` de next.config.ts y `POST /api/ai-token`.
 * - `AI_API_KEY`: API key del tenant en ai-api (para `/v1/end-user-sessions`).
 * - `AI_AGENT_ID`: agente con el que chatea el widget (no es secreto).
 *
 * Falta cualquiera ⇒ `null` ⇒ no hay chat aunque el flag `chat-ia` esté prendido.
 */
export interface AiApiConfig {
  url: string;
  apiKey: string;
  agentId: string;
}

/** Base http(s) sin barra final, o null si no es una URL usable. */
export function normalizarUrlAiApi(valor: string | undefined): string | null {
  const v = valor?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return v.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function aiApiConfig(env: Record<string, string | undefined> = process.env): AiApiConfig | null {
  const url = normalizarUrlAiApi(env.AI_API_URL);
  const apiKey = env.AI_API_KEY?.trim();
  const agentId = env.AI_AGENT_ID?.trim();
  if (!url || !apiKey || !agentId) return null;
  return { url, apiKey, agentId };
}
