"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChatDrawer, type CommerceCallbacks } from "@myd-org/ai-widget/preset";
import "@myd-org/ai-widget/styles";
import { useCart } from "@/context/CartContext";
import type { PropsChatIa } from "@/lib/chat-ia";
import { hrefWhatsApp, mensajeTraspaso } from "@/lib/chat-ia-handoff";
import { lineasAItems, type ProductoResuelto } from "@/lib/chat-ia-productos";
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

/**
 * El widget manda `Authorization: Bearer ` (vacío) si el usuario escribe antes de que su
 * token llegue, o si el pedido inicial falló, y `createConversation` no reintenta ante un
 * 401: ai-api responde `missing_session_token` y el chat muestra "la sesión venció" sin que
 * recargar sirva de nada. Este fetch se asegura de que el pedido lleve un token y, si ai-api
 * lo rechaza (401), pide uno nuevo y reintenta una vez.
 */
let tokenEnCurso: Promise<string> | null = null;

function obtenerToken(renovar = false): Promise<string> {
  if (renovar || !tokenEnCurso) {
    const pedido = pedirToken();
    tokenEnCurso = pedido;
    // Un fallo no se queda cacheado: el próximo pedido vuelve a intentar.
    pedido.catch(() => {
      if (tokenEnCurso === pedido) tokenEnCurso = null;
    });
  }
  return tokenEnCurso;
}

const conBearer = (init: RequestInit | undefined, token: string): RequestInit => {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
};

const tieneToken = (init: RequestInit | undefined) =>
  (new Headers(init?.headers).get("Authorization") ?? "").replace(/^Bearer\s*/i, "").length > 0;

const fetchConToken: typeof fetch = async (input, init) => {
  const primero = tieneToken(init) ? init : conBearer(init, await obtenerToken());
  const res = await fetch(input, primero);
  if (res.status !== 401) return res;
  return fetch(input, conBearer(init, await obtenerToken(true)));
};

/**
 * Lo último que el servidor devolvió para cada id. "Agregar" casi siempre viene
 * justo después de que la card se dibujó, así que en general no hace falta
 * volver a pedir: el carrito igual recotiza todo en /api/carrito/cotizar.
 */
const resueltos = new Map<string, ProductoResuelto>();

async function resolver(ids: readonly string[]): Promise<ProductoResuelto[]> {
  if (ids.length === 0) return [];
  const res = await fetch(`/api/chat-ia/productos?ids=${ids.join(",")}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`chat-ia/productos ${res.status}`);
  const productos = (await res.json()) as ProductoResuelto[];
  for (const p of productos) resueltos.set(p.id, p);
  return productos;
}

export default function ChatIaWidget({ agentId, titulo }: PropsChatIa) {
  const router = useRouter();
  const { addItems, items } = useCart();

  // Acciones de las cards de venta (platform ADR 0014). La card trae ids: el
  // precio y la foto salen de /api/chat-ia/productos con la lista de quien mira.
  const commerce = useMemo<CommerceCallbacks>(
    () => ({
      resolveProducts: resolver,
      onAddProducts: (lineas) => {
        const faltan = lineas.map((l) => l.id).filter((id) => !resueltos.has(id));
        void (faltan.length ? resolver(faltan) : Promise.resolve([]))
          .catch(() => [])
          .then(() => addItems(lineasAItems(lineas, resueltos)));
      },
      onOpenProduct: (id) => router.push(`/producto/${encodeURIComponent(id)}`),
      onHandoff: (card) => {
        const mensaje = mensajeTraspaso(
          card.summary,
          items.map(({ id, qty }) => ({ id, qty })),
          window.location.origin,
        );
        const href = hrefWhatsApp(card.phone, mensaje);
        if (href) window.open(href, "_blank", "noopener,noreferrer");
      },
    }),
    [addItems, items, router],
  );

  const config = useMemo(() => ({ baseUrl: "/ai-api", agentId, fetchToken: pedirToken, fetch: fetchConToken }), [agentId]);

  return (
    <ChatDrawer
      config={config}
      branding={{ title: titulo, subtitle: SUBTITULO_CHAT, primaryColor: COLOR_CHAT }}
      labels={{ ...ETIQUETAS_CHAT, headerTitle: titulo }}
      theme="light"
      commerce={commerce}
    />
  );
}
