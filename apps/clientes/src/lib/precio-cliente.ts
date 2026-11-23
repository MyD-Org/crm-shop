/**
 * Precio general tachado para quien ve sus precios de cliente (lista online privada, change
 * `listas-cuenta-corriente`). Puro: sirve en server y cliente.
 *
 * El catálogo cacheado trae SIEMPRE el precio público; el privado llega por request desde
 * `/api/precios-cuenta`. La comparación se hace en el navegador con esos dos datos, así la lista
 * privada nunca entra en datos públicos ni cacheados.
 *
 * Regla: se tacha el precio público CON TRANSFERENCIA sólo si su precio de cliente es MENOR. Igual o
 * mayor: sin tachado (el privado se muestra igual, es el que se le factura). "Consulte": nada.
 */
import type { Product } from "@/data/products";
import { SLUG_TRANSFERENCIA } from "./cuentas-bancarias";

/** Un precio para exhibir: el final con IVA si se conoce, si no el neto. */
function exhibido(neto: number | undefined, final: number | undefined): number | undefined {
  const v = final ?? neto;
  return v != null && Number.isFinite(v) && v > 0 ? v : undefined;
}

/**
 * Precio público con transferencia (para exhibir) de un producto TAL COMO VIENE DEL CATÁLOGO
 * PÚBLICO (antes de aplicarle el precio de la cuenta). Si la transferencia tiene una lista más
 * barata, ése; si no, el general (pagar con transferencia cuesta lo mismo que la lista general).
 */
export function precioPublicoConTransferencia(
  p: Pick<Product, "price" | "precioFinal" | "precioMedio" | "preciosMedios" | "preciosOfflineModal">,
): number | undefined {
  const deMedio = [p.precioMedio, ...(p.preciosMedios ?? [])].find(
    (m) => m != null && m.slug === SLUG_TRANSFERENCIA && m.forma == null,
  );
  if (deMedio) {
    const v = exhibido(deMedio.price, deMedio.precioFinal);
    if (v != null) return v;
  }
  const offline = p.preciosOfflineModal?.find((m) => m.slug === SLUG_TRANSFERENCIA);
  if (offline) {
    const v = exhibido(undefined, offline.precioFinal);
    if (v != null) return v;
  }
  return exhibido(p.price, p.precioFinal);
}

/**
 * El precio a tachar sobre su precio de cliente, o `undefined` si no corresponde (su precio es igual
 * o mayor, o falta alguno de los dos).
 */
export function precioGeneralTachado(
  privadoExhibido: number | undefined,
  publicoExhibido: number | undefined,
): number | undefined {
  if (privadoExhibido == null || publicoExhibido == null) return undefined;
  if (!(privadoExhibido > 0) || !(publicoExhibido > 0)) return undefined;
  return privadoExhibido < publicoExhibido ? publicoExhibido : undefined;
}

/**
 * ¿El precio que se ve es su precio de cliente? Sólo con precio privado y sin una campaña que le
 * gane (en ese caso el precio es el de campaña y se tacha su privado: ver `aplicarEstadoPrecio`).
 */
export function esPrecioDeCliente(p: Pick<Product, "precioCuenta" | "campania">): boolean {
  return p.precioCuenta === "privado" && !p.campania;
}
