/**
 * Traspaso del chat a WhatsApp de ventas (card `handoff`, platform ADR 0014).
 * El inbox del CRM no muestra conversaciones web, así que la persona atiende
 * por WhatsApp: el mensaje ya escrito lleva el resumen que armó el agente y,
 * si hay algo en el carrito, el link del carrito compartido para que el
 * vendedor lo abra con un toque. Puro: sin DOM ni Next.
 */
import type { LineaCarrito } from "./carrito-cliente";
import { hrefCompartido } from "./carrito-compartido";

/** wa.me corta mensajes muy largos según el cliente; el resumen ya viene acotado a 500. */
const TELEFONO = /^[0-9]{8,15}$/;

export function mensajeTraspaso(resumen: string, carrito: readonly LineaCarrito[], origen: string): string {
  const texto = resumen.trim();
  if (carrito.length === 0) return texto;
  return `${texto}\n\nCarrito: ${origen.replace(/\/+$/, "")}${hrefCompartido(carrito)}`;
}

/** Link a WhatsApp, o null si el teléfono no es E.164 sin `+` (no se arma un link roto). */
export function hrefWhatsApp(telefono: string, mensaje: string): string | null {
  if (!TELEFONO.test(telefono)) return null;
  return `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
}
