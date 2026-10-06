/**
 * Estado del precio de la cuenta en el navegador (change `listas-cuenta-corriente`). Puro: lo usa el
 * hook `usePreciosCuenta` y se prueba sin DOM.
 *
 * El catálogo sale de una caché compartida con el precio PÚBLICO. Quien tiene una lista privada ve
 * otro precio, que llega recién por `/api/precios-cuenta`. Para no mostrarle el público y después
 * cambiárselo (parpadeo), mientras el overlay no llega, un visitante con sesión ve un MARCADOR en
 * lugar del precio. Un anónimo nunca ve marcador. Si el overlay falla o dice que no hay lista
 * privada, queda el público: el marcador nunca es eterno.
 */
import type { Product } from "@/data/products";
import type { PrecioCuenta } from "./precio-cuenta";

/** Lo que se sabe de un id: precio privado, sin precio en la lista (Consulte) o "rige el público". */
export type ValorCuenta = PrecioCuenta | null | "publico";

export type EstadoPrecioCuenta =
  | { tipo: "pendiente" }
  | { tipo: "privado"; precio: PrecioCuenta }
  | { tipo: "consulte" };

/**
 * `undefined` = rige el precio público (sin marcador). `sinLista` = el servidor ya dijo que este
 * visitante no tiene lista privada.
 */
export function estadoDe(
  id: string,
  cache: ReadonlyMap<string, ValorCuenta>,
  ctx: { sinLista: boolean; sesion: boolean },
): EstadoPrecioCuenta | undefined {
  const v = cache.get(id);
  if (v === "publico") return undefined;
  if (v === null) return { tipo: "consulte" };
  if (v !== undefined) return { tipo: "privado", precio: v };
  if (ctx.sinLista || !ctx.sesion) return undefined;
  return { tipo: "pendiente" };
}

/**
 * ¿Hay sesión de Clerk? Se lee de la cookie `__client_uat` (no HttpOnly): su valor es 0 sin sesión y
 * un timestamp con sesión. Es sólo una PISTA para decidir si mostrar el marcador; el precio privado
 * lo decide siempre el servidor desde la sesión verdadera.
 */
export function sesionPorCookie(cookie: string): boolean {
  const m = /(?:^|;\s*)__client_uat(?:_[A-Za-z0-9]+)?=(\d+)/.exec(cookie);
  return m != null && Number(m[1]) > 0;
}

/**
 * El producto con el precio de la cuenta aplicado. Con precio privado: `price`/`precioFinal` pasan
 * a ser los de su lista (sin tachar el público: se muestra siempre, aunque sea mayor) y se ocultan
 * "$X con medio", cuotas y descuentos por medio. Consulte: sin precio (la ficha ya dice "Consulte" y
 * bloquea el agregado). Sin estado devuelve el mismo objeto.
 */
export function aplicarEstadoPrecio(p: Product, estado: EstadoPrecioCuenta | undefined): Product {
  if (!estado) return p;
  const sinMedios = {
    precioMedio: undefined,
    preciosMedios: undefined,
    cuotasSinInteres: undefined,
    oldPrice: undefined,
    discount: undefined,
  };
  if (estado.tipo === "privado") {
    return {
      ...p,
      ...sinMedios,
      price: estado.precio.price,
      precioFinal: estado.precio.precioFinal,
      precioCuenta: "privado",
    };
  }
  if (estado.tipo === "consulte") {
    return { ...p, ...sinMedios, price: 0, precioFinal: undefined, precioCuenta: "consulte" };
  }
  return { ...p, ...sinMedios, precioCuenta: "pendiente" };
}
