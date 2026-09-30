"use client";

import { useSyncExternalStore } from "react";
import {
  conversar,
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
 * - `pedido`: último pedido `{ id, text }`, para el `sendRequest` del widget.
 * - `registrar()`: lo llama el widget al montarse (devuelve la baja).
 */
export function useChatIa(): EstadoChatIa & {
  conversar: typeof conversar;
  registrar: typeof registrarChatIa;
} {
  const estado = useSyncExternalStore(suscribirChatIa, estadoChatIa, estadoChatIaServidor);
  return { ...estado, conversar, registrar: registrarChatIa };
}
