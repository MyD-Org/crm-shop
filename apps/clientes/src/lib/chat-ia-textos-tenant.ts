/**
 * Textos del chat que el equipo edita en el admin del CRM (Datos → Chat de la
 * tienda): el del chat vacío y las preguntas sugeridas. SOLO servidor. Se leen
 * de `public.tenants` (GRANT por columna, migración 0078 de apps/admin) en cada
 * request, así que lo guardado se ve en la próxima página sin avisarle al Shop.
 *
 * Consulta aparte de `datosTenant`: si estas columnas fallan, el chat cae a los
 * textos por defecto y Mi cuenta no se entera.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmTenants } from "@/db/crm";
import { shopTenantId } from "./tenant";
import { ETIQUETAS_CHAT, SUGERENCIAS_CHAT } from "./chat-ia-textos";

export interface TextosChatTenant {
  emptyState: string;
  suggestions: string[];
}

/** Topes del lado del Shop (el admin valida igual): una fila tocada a mano no rompe el widget. */
const SUGERENCIAS_MAX = 4;
const TEXTO_MAX = 120;

const limpio = (v: unknown): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, TEXTO_MAX) : "";

/** Vacío ⇒ los textos actuales de `chat-ia-textos.ts`. Campo por campo. */
export function conDefaults(fila: { chatEmptyState?: unknown; chatSuggestions?: unknown } | null): TextosChatTenant {
  const emptyState = limpio(fila?.chatEmptyState) || ETIQUETAS_CHAT.emptyState;
  const cargadas = Array.isArray(fila?.chatSuggestions)
    ? fila.chatSuggestions.map(limpio).filter(Boolean).slice(0, SUGERENCIAS_MAX)
    : [];
  return { emptyState, suggestions: cargadas.length ? cargadas : [...SUGERENCIAS_CHAT] };
}

export async function textosChatTenant(): Promise<TextosChatTenant> {
  try {
    const [fila] = await getDb()
      .select({ chatEmptyState: crmTenants.chatEmptyState, chatSuggestions: crmTenants.chatSuggestions })
      .from(crmTenants)
      .where(eq(crmTenants.id, shopTenantId()))
      .limit(1);
    return conDefaults(fila ?? null);
  } catch (err) {
    console.error(`[chat-ia] no se pudieron leer los textos del chat: ${err instanceof Error ? err.name : "desconocido"}`);
    return conDefaults(null);
  }
}
