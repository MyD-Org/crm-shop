/**
 * Carrito compartido por link: reglas PURAS (sin DB, sin Next) que usan la
 * página `/carrito/compartido` en el servidor y el botón de compartir en el
 * navegador.
 *
 * El link es una FOTO del carrito, no un acceso al carrito de quien lo mandó:
 * `/carrito/compartido?i=12:3,5:1`. Sólo viajan id de Alegra y cantidad, lo
 * mismo que el servidor acepta del navegador en /api/carrito. Precio, nombre y
 * stock los resuelve siempre el servidor del que recibe.
 */

import {
  contenidoDistinto,
  esIdValido,
  MAX_ENTRADAS_BODY,
  normalizarCarrito,
  type CartItem,
  type LineaCarrito,
} from "./carrito-cliente";

export const RUTA_COMPARTIDO = "/carrito/compartido";

/** Valor del parámetro `i`: `id:qty` separados por coma. */
export function codificarCompartido(items: readonly LineaCarrito[]): string {
  return items.map(({ id, qty }) => `${id}:${qty}`).join(",");
}

/**
 * `:` y `,` son válidos sin escapar en el query, así que el link queda legible
 * y corto (con MAX_LINEAS e ids de Alegra, del orden de 500 caracteres).
 */
export function hrefCompartido(items: readonly LineaCarrito[]): string {
  return `${RUTA_COMPARTIDO}?i=${codificarCompartido(items)}`;
}

/**
 * Tolerante a propósito: el link pasa por chats que lo cortan o lo editan. Un
 * par roto se descarta y los demás siguen; nunca tira. Lee a lo sumo
 * MAX_ENTRADAS_BODY pares (lo mismo que acepta la API) y después aplica las
 * reglas de siempre del carrito: duplicados suman, QTY_MAX y MAX_LINEAS.
 */
export function parsearCompartido(raw: string | null | undefined): LineaCarrito[] {
  if (!raw) return [];
  const lineas: LineaCarrito[] = [];
  for (const par of raw.split(",", MAX_ENTRADAS_BODY)) {
    const [id, qtyTexto, ...resto] = par.trim().split(":");
    if (resto.length > 0 || !esIdValido(id) || !/^\d+$/.test(qtyTexto ?? "")) continue;
    const qty = Number(qtyTexto);
    if (qty > 0) lineas.push({ id, qty });
  }
  return normalizarCarrito(lineas).items;
}

/**
 * Qué hacer al tocar "Cargar al carrito":
 * - `cargar`: el carrito está vacío, no hay nada que perder.
 * - `igual`: ya tiene exactamente eso (p. ej. quien compartió abrió su link).
 * - `preguntar`: reemplazar o sumar lo decide el usuario.
 */
export type AccionCompartido = "cargar" | "preguntar" | "igual";

export function accionAlCompartir(
  actual: readonly LineaCarrito[],
  compartido: readonly LineaCarrito[],
): AccionCompartido {
  if (actual.length === 0) return "cargar";
  return contenidoDistinto(actual, compartido) ? "preguntar" : "igual";
}

/**
 * Lo que no está en el catálogo o no tiene precio no se ofrece para cargar:
 * `addItems` lo descartaría igual, pero en silencio. La preview lo muestra
 * aparte.
 */
export function separarDisponibles(items: CartItem[]): {
  disponibles: CartItem[];
  noDisponibles: CartItem[];
} {
  const disponibles: CartItem[] = [];
  const noDisponibles: CartItem[] = [];
  for (const i of items) (i.faltante || !(i.price > 0) ? noDisponibles : disponibles).push(i);
  return { disponibles, noDisponibles };
}
