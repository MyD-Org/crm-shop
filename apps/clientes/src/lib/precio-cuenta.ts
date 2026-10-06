/**
 * Precio de la lista privada del comprador (change `listas-cuenta-corriente`), tal como lo
 * superpone en el navegador el overlay `/api/precios-cuenta` sobre el catálogo cacheado (que
 * siempre trae el precio público). Pura: sirve en server y cliente.
 *
 * A diferencia del precio especial #219 (retirado), el precio privado se muestra SIEMPRE, aunque
 * sea mayor que el público: es el que se factura a esa cuenta. Sin precio en su lista ⇒ `null`
 * ("Consulte"): nunca se cae al público.
 */

import { precioFinal } from "./precio-final";

export interface PrecioCuenta {
  /** Neto (sin IVA) de la lista privada. */
  price: number;
  /** Final con IVA. undefined = sin IVA conocido. */
  precioFinal?: number;
}

/** `null` si el producto no tiene precio válido (> 0) en la lista privada. */
export function precioPrivado(
  neto: number | null | undefined,
  ivaPorcentaje: number | null | undefined,
): PrecioCuenta | null {
  if (neto == null || !Number.isFinite(neto) || !(neto > 0)) return null;
  const final = precioFinal(neto, ivaPorcentaje);
  return final != null ? { price: neto, precioFinal: final } : { price: neto };
}
