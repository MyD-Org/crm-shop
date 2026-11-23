/**
 * Precio general tachado para quien ve sus precios de cliente (lista online privada, change
 * `listas-cuenta-corriente`). Puro: sirve en server y cliente.
 *
 * El catálogo cacheado trae SIEMPRE el precio público; el privado llega por request desde
 * `/api/precios-cuenta`. La comparación se hace en el navegador con esos dos datos, así la lista
 * privada nunca entra en datos públicos ni cacheados.
 *
 * Regla: se tacha el precio público MÁS ALTO (decisión de la usuaria, 2026-11-23: el de "otros
 * medios", la lista de referencia) sólo si su precio de cliente es MENOR. Igual o mayor: sin tachado (el privado se muestra igual, es el que se le factura). "Consulte": nada.
 */
import type { Product } from "@/data/products";

/** Un precio para exhibir: el final con IVA si se conoce, si no el neto. */
function exhibido(neto: number | undefined, final: number | undefined): number | undefined {
  const v = final ?? neto;
  return v != null && Number.isFinite(v) && v > 0 ? v : undefined;
}

/**
 * Precio público más alto (para exhibir) de un producto TAL COMO VIENE DEL CATÁLOGO PÚBLICO: el
 * mayor entre el general y los de cada medio de pago (en un pago). Es el que se tacha. Con una
 * campaña activa, el de campaña: es lo que paga cualquiera y no se tacha un precio que nadie paga.
 */
export function precioPublicoMasAlto(
  p: Pick<Product, "price" | "precioFinal" | "precioMedio" | "preciosMedios" | "preciosOfflineModal" | "campania">,
): number | undefined {
  if (p.campania) return exhibido(p.price, p.precioFinal);
  const candidatos = [
    exhibido(p.price, p.precioFinal),
    ...[p.precioMedio, ...(p.preciosMedios ?? [])].map((m) => (m ? exhibido(m.price, m.precioFinal) : undefined)),
    ...(p.preciosOfflineModal ?? []).map((m) => exhibido(undefined, m.precioFinal)),
  ].filter((v): v is number => v != null);
  return candidatos.length > 0 ? Math.max(...candidatos) : undefined;
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

/**
 * Cuánto menos paga con su precio de cliente respecto del general tachado, en % entero. `null` si
 * no hay tachado, si el general no es mayor o si redondea a 0 (no se muestra "0% menos").
 */
export function porcentajeAhorro(precio: number | null | undefined, general: number | null | undefined): number | null {
  if (precio == null || general == null || !(general > 0) || !(precio > 0) || precio >= general) return null;
  const pct = Math.round((1 - precio / general) * 100);
  return pct >= 1 ? pct : null;
}
