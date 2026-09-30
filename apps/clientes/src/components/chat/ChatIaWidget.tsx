"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChatDrawer, type ChatPresentation, type CommerceCallbacks } from "@myd-org/ai-widget/preset";
import "@myd-org/ai-widget/styles";
import { useCart } from "@/context/CartContext";
import type { PropsChatIa } from "@/lib/chat-ia";
import { hrefWhatsApp, mensajeTraspaso } from "@/lib/chat-ia-handoff";
import { lineasAItems, type ProductoResuelto } from "@/lib/chat-ia-productos";
import { COLOR_CHAT, ETIQUETAS_CHAT, SUBTITULO_CHAT } from "@/lib/chat-ia-textos";
import { useChatIa } from "@/hooks/useChatIa";
import { useSenalesIniciativa } from "@/hooks/useSenalesIniciativa";
import { contextoParaChat } from "@/lib/chat-ia-puente";
import {
  ATRIBUTO_DOCK,
  ATRIBUTO_PEEK,
  BREAKPOINT_MOBILE,
  MEDIA_DOCK,
  MEDIA_MOBILE,
  comoDeshacer,
  hojaMinimizada,
  hrefDeFiltros,
  idProductoDeRuta,
  puedeNavegarSolo,
} from "@/lib/chat-ia-integracion";

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

/**
 * ¿Cumple la pantalla una media query? (sigue los cambios). Para el dock
 * (`MEDIA_DOCK`) y la hoja mobile (`MEDIA_MOBILE`). En el servidor, no.
 */
function useMedia(query: string): boolean {
  const suscribir = useCallback(
    (aviso: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", aviso);
      return () => mq.removeEventListener("change", aviso);
    },
    [query],
  );
  return useSyncExternalStore(suscribir, () => window.matchMedia(query).matches, () => false);
}

/**
 * Nombre del producto de la ficha para el contexto de pantalla: el `<h1>` de
 * la página (la ficha lo tiene). Barato y sin pedir nada; si no está, el
 * contexto va sin producto.
 */
function nombreEnPantalla(): string | undefined {
  return document.querySelector("main h1")?.textContent?.trim() || undefined;
}

export default function ChatIaWidget({ agentId, titulo }: PropsChatIa) {
  const router = useRouter();
  const pathname = usePathname();
  const { addItems, items, updateQty, removeItem, cambio } = useCart();

  // Puente con la página (lib/chat-ia-puente.ts): al montarse, el chat queda
  // disponible para los "Conversar" del catálogo; `pedido` es su `sendRequest`.
  const { registrar, pedido, teaser, aceptarTeaser, descartarTeaser } = useChatIa();
  useEffect(() => registrar(), [registrar]);

  // Abierto controlado (el drawer se abre solo al llegar un `sendRequest`, y
  // avisa por `onOpenChange`). Desde 1280 px se acopla a la derecha. El puente
  // se entera por `useSenalesIniciativa` (`fijarChatAbierto`), en cada cambio.
  const [abierto, setAbierto] = useState(false);
  const acoplable = useMedia(MEDIA_DOCK);
  const acoplado = acoplable && abierto;

  // Hoja mobile (< 768 px): presentación controlada ("expanded" | "peek"). El
  // widget pide los cambios (Minimizar, arrastre, atrás del sistema, card que
  // navegó sola, abrir) por `onPresentationChange` y acá se reflejan. Cerrar
  // o un pedido nuevo de la página ("Conversar", una pregunta sugerida, el
  // teaser) vuelven a "expanded": lo que se acaba de pedir se tiene que ver.
  const mobile = useMedia(MEDIA_MOBILE);
  const [presentacion, setPresentacion] = useState<ChatPresentation>("expanded");
  const [ultimoPedido, setUltimoPedido] = useState(pedido?.id);
  if (pedido?.id !== ultimoPedido) {
    setUltimoPedido(pedido?.id);
    setPresentacion("expanded");
  }
  const cambiarAbierto = useCallback((siguiente: boolean) => {
    setAbierto(siguiente);
    if (!siguiente) setPresentacion("expanded");
  }, []);
  const minimizada = hojaMinimizada({ mobile, abierto, presentacion });

  // Hoja minimizada: globals.css sube las barras de compra fijas (ficha,
  // carrito) por encima de la barra del chat.
  useEffect(() => {
    const html = document.documentElement;
    if (minimizada) html.setAttribute(ATRIBUTO_PEEK, "");
    else html.removeAttribute(ATRIBUTO_PEEK);
    return () => html.removeAttribute(ATRIBUTO_PEEK);
  }, [minimizada]);

  // Invitación proactiva (src/lib/iniciativa/): chat abierto, checkout,
  // agregados al carrito y la espera en la ficha. El teaser queda en el puente
  // (`teaser`, `aceptarTeaser`, `descartarTeaser`) para el launcher.
  useSenalesIniciativa({ pathname, abierto, cambio });

  // Acoplado y abierto, el layout le reserva el ancho (`padding-right` en
  // globals.css): el contenido se corre en vez de quedar tapado. Arranca sin
  // el atributo (el chat siempre carga cerrado): nada salta en el primer pintado.
  useEffect(() => {
    const html = document.documentElement;
    if (acoplado) html.setAttribute(ATRIBUTO_DOCK, "abierto");
    else html.removeAttribute(ATRIBUTO_DOCK);
    return () => html.removeAttribute(ATRIBUTO_DOCK);
  }, [acoplado]);

  // Lo último de la página para los callbacks que el widget llama más tarde
  // (contexto de pantalla, navegación automática) sin rearmar la config.
  const vigente = useRef({ pathname, lineas: items.length, acoplado, abierto, mobile });
  useEffect(() => {
    vigente.current = { pathname, lineas: items.length, acoplado, abierto, mobile };
  }, [pathname, items.length, acoplado, abierto, mobile]);

  // Cantidad de cada producto en el carrito: con esto la card del chat pasa de "Agregar" al
  // contador, igual que en el catálogo.
  const cartQuantities = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i.qty])), [items]);

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
      onSetQuantity: (id, qty) => (qty <= 0 ? removeItem(id) : updateQty(id, qty)),
      cartQuantities,
      onOpenProduct: (id) => router.push(`/producto/${encodeURIComponent(id)}`),
      // Card `catalog`: la URL la arma catalogo-url (descarta lo inválido) y
      // "Deshacer" vuelve a la página anterior.
      onNavigateCatalog: (filtros) => {
        const anterior = `${window.location.pathname}${window.location.search}`;
        const destino = hrefDeFiltros(filtros);
        router.push(destino);
        return {
          undo: () => {
            const actual = `${window.location.pathname}${window.location.search}`;
            if (comoDeshacer(actual, destino) === "atras") router.back();
            else router.push(anterior);
          },
        };
      },
      shouldAutoNavigate: () => puedeNavegarSolo(vigente.current),
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
    [addItems, cartQuantities, items, removeItem, router, updateQty],
  );

  const config = useMemo(
    () => ({
      baseUrl: "/ai-api",
      agentId,
      fetchToken: pedirToken,
      fetch: fetchConToken,
      // Contexto de pantalla con cada mensaje (contrato contexto-pantalla-shop/v1).
      getPageContext: () => {
        const { pathname: ruta, lineas } = vigente.current;
        const id = idProductoDeRuta(ruta);
        const nombre = id ? nombreEnPantalla() : undefined;
        return contextoParaChat(ruta, {
          ...(id && nombre ? { producto: { id, name: nombre } } : {}),
          carrito: { lineas },
        });
      },
    }),
    [agentId],
  );

  return (
    <ChatDrawer
      config={config}
      branding={{ title: titulo, subtitle: SUBTITULO_CHAT, primaryColor: COLOR_CHAT }}
      labels={{ ...ETIQUETAS_CHAT, headerTitle: titulo }}
      theme="light"
      enableHistory
      commerce={commerce}
      open={abierto}
      onOpenChange={cambiarAbierto}
      dock={acoplable ? "right" : "none"}
      sendRequest={pedido ?? undefined}
      mobileBreakpoint={BREAKPOINT_MOBILE}
      presentation={presentacion}
      onPresentationChange={setPresentacion}
      // Invitación proactiva (src/lib/iniciativa/): el puente cuenta los topes
      // al aceptar o cerrar; el widget sólo la dibuja.
      teaser={teaser ?? undefined}
      onTeaserAction={aceptarTeaser}
      onTeaserDismiss={descartarTeaser}
    />
  );
}
