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
 * Invitación proactiva (teaser del launcher, spec fase 2 §3): el motor de
 * señales (src/lib/iniciativa/motor.ts) propone un `teaser` con
 * `proponerTeaser`; el widget lo dibuja junto al launcher y responde con
 * `aceptarTeaser(id)` (abre el chat con `teaser.mensaje` y cuenta para el tope)
 * o `descartarTeaser(id)` (lo cierra, cuenta para el tope y no vuelve en la
 * sesión). Con el chat abierto no hay teaser: el widget avisa con
 * `fijarChatAbierto`. Nada de esto gasta tokens hasta que el visitante acepta.
 *
 * Store de módulo (sin React) para poder testearlo en node; el hook
 * `useChatIa` (src/hooks/useChatIa.ts) lo lee con `useSyncExternalStore`.
 */
import { contextoPantalla, type ContextoPantallaShop, type EntradaContexto } from "./contexto-pantalla";
import { marcarTope } from "./iniciativa/almacen";

export interface PedidoChatIa {
  /** Cambia con cada pedido: el widget envía cuando ve un id nuevo. */
  id: string;
  text: string;
}

/**
 * Invitación proactiva para el launcher. `text`, `actionLabel` y
 * `dismissLabel` son lo que se dibuja; `mensaje`, lo que se envía al aceptar.
 */
export interface TeaserChatIa {
  /** Cambia con cada invitación; es lo que vuelve en aceptar/descartar. */
  id: string;
  text: string;
  actionLabel: string;
  dismissLabel: string;
  mensaje: string;
}

/** Orden de abrir o cerrar el chat (botón "Asistente" del header). */
export interface OrdenChatIa {
  /** Cambia con cada orden: el widget la aplica cuando ve un id nuevo. */
  id: string;
  abrir: boolean;
}

export interface EstadoChatIa {
  /** Hay un chat montado que puede recibir pedidos. */
  disponible: boolean;
  /** El chat está abierto (lo avisa el widget con `fijarChatAbierto`). */
  abierto: boolean;
  /** Última orden de abrir/cerrar, o null. */
  orden: OrdenChatIa | null;
  /** Último pedido de conversación, o null. */
  pedido: PedidoChatIa | null;
  /** Invitación vigente para el launcher, o null. */
  teaser: TeaserChatIa | null;
}

/** Tope del texto que se manda como primer mensaje (el de la búsqueda). */
export const LARGO_MAX_PEDIDO = 500;

const INICIAL: EstadoChatIa = { disponible: false, abierto: false, orden: null, pedido: null, teaser: null };

let estado: EstadoChatIa = INICIAL;
let registrados = 0;
let secuencia = 0;
let chatAbierto = false;
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
const ESTADO_SERVIDOR: EstadoChatIa = INICIAL;
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
    if (registrados === 0) {
      chatAbierto = false;
      publicar(INICIAL);
    }
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

/**
 * Abre el chat si está cerrado y lo cierra si está abierto (botón "Asistente"
 * del header). `false` (y nada cambia) si no hay chat.
 */
export function alternarChatIa(): boolean {
  if (!estado.disponible) return false;
  secuencia += 1;
  publicar({ ...estado, orden: { id: `orden-${secuencia}`, abrir: !chatAbierto } });
  return true;
}

/** El último pedido (lo que el widget pasa como `sendRequest`). */
export function pedidoChatIa(): PedidoChatIa | null {
  return estado.pedido;
}

/**
 * El widget avisa si el chat está abierto: abierto, no se invita, y la
 * invitación que hubiera se retira (sin contar como cerrada).
 */
export function fijarChatAbierto(abierto: boolean): void {
  chatAbierto = abierto;
  const teaser = abierto ? null : estado.teaser;
  if (estado.abierto !== abierto || estado.teaser !== teaser) publicar({ ...estado, abierto, teaser });
}

export function chatIaAbierto(): boolean {
  return chatAbierto;
}

/**
 * Propone una invitación. Solo prende si hay chat, está cerrado y no hay otra
 * a la vista; devuelve el teaser publicado o null.
 */
export function proponerTeaser(teaser: Omit<TeaserChatIa, "id"> & { senal: string }): TeaserChatIa | null {
  if (!estado.disponible || chatAbierto || estado.teaser) return null;
  secuencia += 1;
  const { senal, ...resto } = teaser;
  const publicado: TeaserChatIa = { ...resto, id: `teaser-${senal}-${secuencia}` };
  publicar({ ...estado, teaser: publicado });
  return publicado;
}

/**
 * "Sí, ayúdeme": abre el chat con el mensaje de la invitación y cuenta para
 * el tope. `false` si `id` no es la invitación vigente.
 */
export function aceptarTeaser(id: string): boolean {
  const teaser = estado.teaser;
  if (!teaser || teaser.id !== id) return false;
  publicar({ ...estado, teaser: null });
  marcarTope({ descartada: false, ahora: Date.now() });
  conversar(teaser.mensaje);
  return true;
}

/** Cerrar: la invitación se va, cuenta para el tope y no vuelve en la sesión. */
export function descartarTeaser(id: string): boolean {
  if (!estado.teaser || estado.teaser.id !== id) return false;
  publicar({ ...estado, teaser: null });
  marcarTope({ descartada: true, ahora: Date.now() });
  return true;
}

/** Saca la invitación sin contarla como cerrada (p.ej. se entró al checkout). */
export function retirarTeaser(): void {
  if (estado.teaser) publicar({ ...estado, teaser: null });
}

/** La invitación vigente (lo que el widget pasa como `teaser`). */
export function teaserChatIa(): TeaserChatIa | null {
  return estado.teaser;
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
  chatAbierto = false;
  estado = INICIAL;
  oyentes.clear();
}
