import type { Product } from "@/data/products";
import type { PrecioCuenta } from "@/lib/precio-cuenta";

/**
 * Ofertas que le sirven a una cuenta con lista privada (decisión 2026-11-27: a un cliente con lista
 * propia sólo se le muestran las ofertas que le aplican). Paga el menor entre su precio y el de
 * campaña de la lista general (`price` del producto del catálogo, igual que `aplicarEstadoPrecio`),
 * así que una oferta le aplica sólo si ese precio de campaña es MENOR que el de su lista. Sin precio
 * en su lista ("Consulte") no le aplica: no puede comprarlo a precio de oferta desde la tienda.
 */
export function ofertasQueAplican(
  productos: readonly Pick<Product, "id" | "price" | "campania">[],
  privados: Readonly<Record<string, PrecioCuenta | null>>,
): string[] {
  return productos
    .filter((p) => {
      const privado = privados[p.id];
      return p.campania != null && privado != null && p.price > 0 && p.price < privado.price;
    })
    .map((p) => p.id);
}

/** Lo que el navegador sabe de las ofertas de la cuenta. */
export type OfertasCuenta =
  /** Anónimo, sin lista privada o sin respuesta: rige lo público (todas las ofertas). */
  | { tipo: "publico" }
  /** Todavía no llegó la respuesta (sólo con sesión). */
  | { tipo: "pendiente" }
  /** Lista privada: sólo estas ofertas le aplican. */
  | { tipo: "privado"; ids: ReadonlySet<string> };

/** ¿Se le muestran ofertas? Público y pendiente: sí (no se esconde nada mientras se pregunta). */
export function hayOfertasParaCuenta(o: OfertasCuenta): boolean {
  return o.tipo !== "privado" || o.ids.size > 0;
}

/** Filtra una lista de productos en oferta a las que le aplican a la cuenta. */
export function filtrarOfertasCuenta<T extends Pick<Product, "id">>(productos: readonly T[], o: OfertasCuenta): T[] {
  return o.tipo === "privado" ? productos.filter((p) => o.ids.has(p.id)) : [...productos];
}
