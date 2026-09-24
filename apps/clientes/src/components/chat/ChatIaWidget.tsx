"use client";

import { ChatDrawer } from "@myd-org/ai-widget/preset";
import "@myd-org/ai-widget/styles";
import type { PropsChatIa } from "@/lib/chat-ia";
import { COLOR_CHAT, ETIQUETAS_CHAT, SUBTITULO_CHAT } from "@/lib/chat-ia-textos";

/**
 * El widget habla con ai-api por `/ai-api/*` (rewrite same-origin de
 * next.config.ts, sin CORS) y pide su token a `POST /api/ai-token`, que decide
 * si la sesión lleva la cuenta del cliente o es de visitante.
 */
async function pedirToken(): Promise<string> {
  const res = await fetch("/api/ai-token", { method: "POST" });
  if (!res.ok) throw new Error(`ai-token ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

export default function ChatIaWidget({ agentId, titulo }: PropsChatIa) {
  return (
    <ChatDrawer
      config={{ baseUrl: "/ai-api", agentId, fetchToken: pedirToken }}
      branding={{ title: titulo, subtitle: SUBTITULO_CHAT, primaryColor: COLOR_CHAT }}
      labels={{ ...ETIQUETAS_CHAT, headerTitle: titulo }}
    />
  );
}
