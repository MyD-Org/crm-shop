/**
 * Precio especial de la cuenta: el de la lista de precios asignada al cliente,
 * cuando es MÁS BAJO que el de la lista general. Pura, sirve en server y cliente.
 *
 * El catálogo y la ficha salen de una caché compartida con la lista general;
 * este precio se superpone en el navegador (ver `usePreciosCuenta`). Si la
 * lista del cliente es igual o más cara, no hay nada que mostrar: tachar un
 * precio más bajo que el que se cobra confunde.
 */

import { precioDeLista, precioGeneral, type AlegraPrice } from "./alegra";
import { precioFinal } from "./precio-final";

export interface PrecioCuenta {
  /** Neto (sin IVA) de la lista del cliente. */
  price: number;
  /** Final con IVA. undefined = sin IVA conocido. */
  precioFinal?: number;
}

export function precioCuenta(
  prices: AlegraPrice[] | undefined,
  ivaPorcentaje: number | null | undefined,
  idPriceList: string | undefined,
): PrecioCuenta | null {
  if (!idPriceList || !Array.isArray(prices)) return null;
  // Misma regla que el carrito y el pedido (`precioDeLista`).
  const precio = precioDeLista(prices, idPriceList);
  if (!(precio > 0) || !(precio < precioGeneral(prices))) return null;
  const propia = { price: precio };
  const final = precioFinal(propia.price, ivaPorcentaje);
  return final != null ? { price: propia.price, precioFinal: final } : { price: propia.price };
}
