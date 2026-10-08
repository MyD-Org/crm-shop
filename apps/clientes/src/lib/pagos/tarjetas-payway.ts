/**
 * Tarjetas que cobra Payway para Central Led: el CONVENIO del comercio (panel de Payway, marcas
 * e-commerce: Visa, Mastercard, American Express y Cabal). Payway no tiene una consulta de marcas
 * habilitadas como la de Mercado Pago, así que la lista es fija y se cambia ACÁ cuando cambie el convenio
 * (no en cada componente). Naranja, Diners y Maestro no están.
 *
 * Todo lo que muestra o limita el formulario de Payway sale de esta lista: los textos de las opciones, los
 * logos, el selector de marca y la validación. Los logos se toman de los que devuelve Mercado Pago
 * (`tarjetas-aceptadas.ts`), unidos por la marca canónica de `marcas.ts`. Módulo PURO.
 */
import { marcaDeMercadoPago, nombreDeMarca, type MarcaTarjeta } from "./marcas";
import type { TarjetaAceptada, TarjetasAceptadas } from "./tarjetas-aceptadas";
import { TARJETAS_PROPIAS } from "./tarjetas-propias";

export type ModalidadConvenio = "credito" | "debito";

/** Marcas del convenio por modalidad, en el orden en que se muestran. */
export const TARJETAS_PAYWAY = {
  credito: ["visa", "mastercard", "amex", "cabal"],
  debito: ["visa", "mastercard", "cabal"],
} as const satisfies Record<ModalidadConvenio, readonly MarcaTarjeta[]>;

export function marcasDePayway(modalidad: ModalidadConvenio): readonly MarcaTarjeta[] {
  return TARJETAS_PAYWAY[modalidad];
}

/** ¿Alguna modalidad del convenio acepta esta marca? */
export function marcaAceptadaPorPayway(id: string | null | undefined): boolean {
  return typeof id === "string" && (TARJETAS_PAYWAY.credito as readonly string[]).concat(TARJETAS_PAYWAY.debito).includes(id);
}

/** "Visa, Mastercard, American Express y Cabal": el texto bajo cada opción cuando no hay logos. */
export function textoMarcasPayway(modalidad: ModalidadConvenio, conjuncion: "y" | "o" = "y"): string {
  const nombres = TARJETAS_PAYWAY[modalidad].map(nombreDeMarca);
  return nombres.length < 2 ? nombres.join("") : `${nombres.slice(0, -1).join(", ")} ${conjuncion} ${nombres[nombres.length - 1]}`;
}

/**
 * Las tarjetas del convenio con el logo de Mercado Pago. Una marca que Mercado Pago no devolvió (o una lista
 * sin `id`, de una caché vieja) usa el logo propio (`tarjetas-propias.ts`): el formulario nunca queda sin logos.
 */
export function tarjetasPayway(deMercadoPago: TarjetasAceptadas | undefined): TarjetasAceptadas {
  const de = (modalidad: ModalidadConvenio): TarjetaAceptada[] =>
    TARJETAS_PAYWAY[modalidad].flatMap((marca) => {
      const delMarca = (x: TarjetaAceptada) => marcaDeMercadoPago(x.id) === marca;
      const t = deMercadoPago?.[modalidad].find(delMarca) ?? TARJETAS_PROPIAS[modalidad].find(delMarca);
      return t ? [t] : [];
    });
  return { credito: de("credito"), debito: de("debito") };
}
