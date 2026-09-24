/**
 * Con qué identidad se abre la sesión del chat en ai-api. SOLO servidor.
 *
 * - Cliente VINCULADO (Clerk + vínculo, o cookie heredada del portal): mismo
 *   `external_id` que usa el portal del CRM (el codigocliente) y un `crm_token`
 *   firmado para el tenant del Shop en `claims`: las tools de cuenta del agente
 *   consultan `/api/agent/*` del CRM con ese token.
 * - Sin vínculo (Clerk sin cuenta de cliente, o anónimo): visitante SIN claims.
 *   En ai-api una tool que necesita `{{end_user.claims.crm_token}}` falla antes
 *   de salir (placeholder inexistente) y el agente sólo puede responder preventa.
 *   El `external_id` lleva prefijo propio para que nunca coincida con un
 *   codigocliente (ni con la historia de chat de un cliente real).
 */
import type { Identidad } from "./auth";
import { mintAgentToken } from "./agent-token";

/** Mensajes `{error}` de `POST /api/ai-token` (en route.ts Next no admite otros exports). */
export const CHAT_NO_DISPONIBLE = "El chat no está disponible en este momento. Inténtelo de nuevo más tarde.";
export const CHAT_DEMASIADOS = "Demasiados intentos de abrir el chat. Inténtelo de nuevo en unos minutos.";

export const PREFIJO_CLERK = "shop-clerk:";
export const PREFIJO_VISITANTE = "shop-visitante:";

/** Cookie httpOnly con el id del visitante anónimo del chat (UUID v4). */
export const COOKIE_VISITANTE = "chat_visitante";
export const VISITANTE_MAX_AGE_S = 60 * 60 * 24 * 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function esIdVisitante(v: string | undefined | null): v is string {
  return !!v && UUID.test(v);
}

export interface SesionChat {
  external_id: string;
  display_name?: string;
  claims?: { crm_token: string };
}

export function sesionChat(
  identidad: Pick<Identidad, "clerkUserId" | "cliente" | "nombre">,
  tenantId: string,
  visitanteId: string,
): SesionChat {
  const { cliente, clerkUserId, nombre } = identidad;
  if (cliente?.codigocliente) {
    return {
      external_id: cliente.codigocliente,
      ...(cliente.razonsocial ? { display_name: cliente.razonsocial } : {}),
      claims: { crm_token: mintAgentToken(cliente.codigocliente, tenantId) },
    };
  }
  if (clerkUserId) {
    return {
      external_id: `${PREFIJO_CLERK}${clerkUserId}`,
      ...(nombre ? { display_name: nombre } : {}),
    };
  }
  return { external_id: `${PREFIJO_VISITANTE}${visitanteId}` };
}
