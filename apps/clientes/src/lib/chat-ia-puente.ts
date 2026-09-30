/**
 * Puente entre la página y el chat del asistente (spec catálogo asistido, §6).
 *
 * El botón "Conversar" (franja y "sin resultados" del catálogo) no conoce al
 * widget: le pide al puente `conversar(texto)`. El widget, cuando está montado
 * (flag `chat-ia` prendido y config de ai-api), se registra con
 * `registrarChatIa()` y lee el último pedido con `pedidoChatIa()`: tiene la
 * forma `{ id, text }` del `sendRequest` de `ChatDrawer` (ai-widget 0.7.0):
 * cuando cambia `id`, el drawer se abre y envía `text`.
 *
 * Sin widget registrado, `disponible` es `false` y los botones "Conversar" no
 * se muestran: nunca queda un botón que no hace nada.
 *
 * Contexto de pantalla: el catálogo publica lo que muestra
 * (`fijarCatalogoParaChat`) y el widget arma su `getPageContext` con
 * `contextoParaChat(pathname, …)` (contrato contexto-pantalla-shop/v1, ver
 * src/lib/contexto-pantalla.ts). No es reactivo: se lee al mandar cada mensaje.
 *
 * Store de módulo (sin React) para poder testearlo en node; el hook
 * `useChatIa` (src/hooks/useChatIa.ts) lo lee con `useSyncExternalStore`.
 */
import { contextoPantalla, type ContextoPantallaShop, type EntradaContexto } from "./contexto-pantalla";

export interface PedidoChatIa {
  /** Cambia con cada pedido: el widget envía cuando ve un id nuevo. */
  id: string;
  text: string;
}

export interface EstadoChatIa {
  /** Hay un chat montado que puede recibir pedidos. */
  disponible: boolean;
  /** Último pedido de conversación, o null. */
  pedido: PedidoChatIa | null;
}

/** Tope del texto que se manda como primer mensaje (el de la búsqueda). */
export const LARGO_MAX_PEDIDO = 500;

let estado: EstadoChatIa = { disponible: false, pedido: null };
let registrados = 0;
let secuencia = 0;
const oyentes = new Set<() => void>();

function publicar(nuevo: EstadoChatIa) {
  estado = nuevo;
  for (const o of oyentes) o();
}

export function suscribirChatIa(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

export function estadoChatIa(): EstadoChatIa {
  return estado;
}

/** Estado del servidor (y del primer render): nunca hay chat. */
const ESTADO_SERVIDOR: EstadoChatIa = { disponible: false, pedido: null };
export function estadoChatIaServidor(): EstadoChatIa {
  return ESTADO_SERVIDOR;
}

/**
 * El widget se registra al montarse; devuelve la baja (para el cleanup del
 * efecto). Con varios registros (StrictMode monta dos veces) cuenta cada uno.
 */
export function registrarChatIa(): () => void {
  registrados += 1;
  if (!estado.disponible) publicar({ ...estado, disponible: true });
  let activo = true;
  return () => {
    if (!activo) return;
    activo = false;
    registrados -= 1;
    if (registrados === 0) publicar({ disponible: false, pedido: null });
  };
}

/**
 * Pide abrir el chat y mandar `texto` como mensaje. `false` (y nada cambia)
 * si no hay chat o el texto queda vacío.
 */
export function conversar(texto: string): boolean {
  const text = texto.replace(/\s+/g, " ").trim().slice(0, LARGO_MAX_PEDIDO);
  if (!estado.disponible || !text) return false;
  secuencia += 1;
  publicar({ ...estado, pedido: { id: `conversar-${secuencia}`, text } });
  return true;
}

/** El último pedido (lo que el widget pasa como `sendRequest`). */
export function pedidoChatIa(): PedidoChatIa | null {
  return estado.pedido;
}

let catalogoVisible: EntradaContexto["catalogo"] | null = null;

/** El catálogo publica lo que muestra (null al desmontarse). */
export function fijarCatalogoParaChat(catalogo: EntradaContexto["catalogo"] | null) {
  catalogoVisible = catalogo ?? null;
}

/**
 * `getPageContext` del widget: el contexto compacto de la página actual. El
 * catálogo sale de lo último que publicó `/catalogo`; ficha y carrito los
 * pasa quien llama (el widget conoce la ruta y el carrito).
 */
export function contextoParaChat(
  pathname: string,
  extras: Pick<EntradaContexto, "producto" | "carrito"> = {},
): ContextoPantallaShop {
  return contextoPantalla({ pathname, ...extras, ...(catalogoVisible ? { catalogo: catalogoVisible } : {}) });
}

/** Solo tests: vuelve al estado inicial. */
export function reiniciarChatIa() {
  catalogoVisible = null;
  registrados = 0;
  secuencia = 0;
  estado = { disponible: false, pedido: null };
  oyentes.clear();
}
