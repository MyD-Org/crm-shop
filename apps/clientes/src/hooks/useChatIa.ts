"use client";

import { useSyncExternalStore } from "react";
import {
  aceptarTeaser,
  alternarChatIa,
  conversar,
  descartarTeaser,
  estadoChatIa,
  estadoChatIaServidor,
  registrarChatIa,
  suscribirChatIa,
  type EstadoChatIa,
} from "@/lib/chat-ia-puente";

/**
 * Puente con el chat del asistente (ver src/lib/chat-ia-puente.ts).
 *
 * - `disponible`: hay un chat montado. Sin él, no mostrar "Conversar".
 * - `conversar(texto)`: abre el chat y manda `texto` como primer mensaje.
 * - `abierto` / `alternar()`: estado del chat y abrir/cerrar (botón del header);
 *   `orden` es la última orden, para el widget.
 * - `pedido`: último pedido `{ id, text }`, para el `sendRequest` del widget.
 * - `teaser`: invitación proactiva vigente, para el `teaser` del widget;
 *   `aceptarTeaser(id)` / `descartarTeaser(id)` son sus dos acciones.
 * - `registrar()`: lo llama el widget al montarse (devuelve la baja).
 */
export function useChatIa(): EstadoChatIa & {
  conversar: typeof conversar;
  alternar: typeof alternarChatIa;
  registrar: typeof registrarChatIa;
  aceptarTeaser: typeof aceptarTeaser;
  descartarTeaser: typeof descartarTeaser;
} {
  const estado = useSyncExternalStore(suscribirChatIa, estadoChatIa, estadoChatIaServidor);
  return { ...estado, conversar, alternar: alternarChatIa, registrar: registrarChatIa, aceptarTeaser, descartarTeaser };
}
