import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { identidadActual } from "@/lib/auth";
import { aiApiConfig } from "@/lib/ai-api-config";
import { chatIaHabilitado } from "@/lib/chat-ia-flag";
import {
  CHAT_DEMASIADOS,
  CHAT_NO_DISPONIBLE,
  COOKIE_VISITANTE,
  VISITANTE_MAX_AGE_S,
  esIdVisitante,
  sesionChat,
} from "@/lib/chat-ia-sesion";
import { jsonNoStore } from "@/lib/cuenta-corriente/guard";
import { permitir } from "@/lib/rate-limit";
import { shopTenantId } from "@/lib/tenant";

/**
 * Techo de sesiones por solicitante. Cada token dura 1 h y el widget lo pide al
 * abrirse y al vencer: 10 cada 10 minutos es holgado para uso real y frena a un
 * script que quiera crear visitantes en ai-api en loop (cada sesión hace un
 * upsert de end_user allá).
 */
const MAX_POR_VENTANA = 10;
const VENTANA_MS = 10 * 60_000;
const TIMEOUT_MS = 10_000;

/** Primera IP de `x-forwarded-for` (la pone Vercel), o null. */
function ipDe(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || req.headers.get("x-real-ip")?.trim() || null;
}

/**
 * POST /api/ai-token
 *
 * Token de sesión del widget del chat (ai-api `/v1/end-user-sessions`). La API
 * key de ai-api y el secreto del `crm_token` nunca salen del servidor: el
 * navegador sólo recibe `{ token }`.
 *
 * - Flag `chat-ia` apagado o sin config de ai-api ⇒ 404 (no hay chat; nada sale
 *   hacia ai-api).
 * - Vinculado ⇒ sesión con `crm_token` (el agente puede consultar su cuenta).
 * - Sin vínculo / anónimo ⇒ visitante sin claims (sólo preventa). El anónimo se
 *   identifica con una cookie httpOnly `chat_visitante` (UUID aleatorio) para
 *   conservar su conversación entre páginas.
 */
export async function POST(req: Request) {
  const config = aiApiConfig();
  if (!config || !(await chatIaHabilitado())) {
    return jsonNoStore({ error: "No encontrado." }, { status: 404 });
  }

  const identidad = await identidadActual();
  const cookieStore = await cookies();
  const visitanteCookie = cookieStore.get(COOKIE_VISITANTE)?.value;
  const visitanteId = esIdVisitante(visitanteCookie) ? visitanteCookie : randomUUID();

  const quien = identidad.cliente?.codigocliente
    ? `cliente:${identidad.cliente.codigocliente}`
    : identidad.clerkUserId
      ? `clerk:${identidad.clerkUserId}`
      : `ip:${ipDe(req) ?? visitanteId}`;
  if (!permitir(`ai-token:${quien}`, MAX_POR_VENTANA, VENTANA_MS)) {
    return jsonNoStore({ error: CHAT_DEMASIADOS }, { status: 429 });
  }

  let token: string;
  try {
    const cuerpo = sesionChat(identidad, shopTenantId(), visitanteId);
    const res = await fetch(`${config.url}/v1/end-user-sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      // Sólo el status: el cuerpo de ai-api puede traer detalles de la sesión.
      console.error(`[ai-token] end-user-sessions respondió ${res.status}`);
      return jsonNoStore({ error: CHAT_NO_DISPONIBLE }, { status: 502 });
    }
    const data = (await res.json()) as { token?: unknown };
    if (typeof data.token !== "string" || !data.token) {
      console.error("[ai-token] end-user-sessions sin token en la respuesta");
      return jsonNoStore({ error: CHAT_NO_DISPONIBLE }, { status: 502 });
    }
    token = data.token;
  } catch (err) {
    console.error(`[ai-token] error: ${err instanceof Error ? err.name : "desconocido"}`);
    return jsonNoStore({ error: CHAT_NO_DISPONIBLE }, { status: 502 });
  }

  // Sólo al visitante anónimo le hace falta la cookie; se renueva en cada token.
  if (!identidad.cliente && !identidad.clerkUserId) {
    cookieStore.set(COOKIE_VISITANTE, visitanteId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: VISITANTE_MAX_AGE_S,
    });
  }

  return jsonNoStore({ token });
}
