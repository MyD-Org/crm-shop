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
 * - `AI_AGENT_ID_CLIENTE` (opcional): agente para el cliente VINCULADO (modelo
 *   más capaz y tools de cuenta). Sin ella, todos usan `AI_AGENT_ID`.
 *
 * Falta cualquiera ⇒ `null` ⇒ no hay chat aunque el flag `chat-ia` esté prendido.
 */
export interface AiApiConfig {
  url: string;
  apiKey: string;
  agentId: string;
  /** Agente del cliente vinculado; ausente = el mismo `agentId`. */
  agentIdCliente?: string;
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
  const agentIdCliente = env.AI_AGENT_ID_CLIENTE?.trim();
  return { url, apiKey, agentId, ...(agentIdCliente ? { agentIdCliente } : {}) };
}

/**
 * TEMPORAL (diagnóstico, revertir): estado de cada variable de ai-api SIN sus valores,
 * para saber cuál falta en el deploy cuando `aiApiConfig()` da null.
 */
export function diagnosticoAiApi(env: Record<string, string | undefined> = process.env) {
  const estado = (v: string | undefined) => (v?.trim() ? "ok" : "ausente");
  return {
    AI_API_URL: !env.AI_API_URL?.trim() ? "ausente" : normalizarUrlAiApi(env.AI_API_URL) ? "ok" : "inválida",
    AI_API_KEY: estado(env.AI_API_KEY),
    AI_AGENT_ID: estado(env.AI_AGENT_ID),
    VERCEL_ENV: env.VERCEL_ENV ?? "(sin VERCEL_ENV)",
  };
}
