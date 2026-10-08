/**
 * Tarjetas que acepta la tienda, con su logo: el footer ("Medios de pago") y "Ver tarjetas aceptadas" del
 * checkout. Con Mercado Pago salen de su API (`GET /v1/payment_methods`): son las habilitadas para la cuenta,
 * no una lista escrita a mano. Payway no tiene esa consulta (depende del convenio del comercio): sus marcas
 * están en `tarjetas-payway.ts` y reutilizan estos logos.
 */

export interface TarjetaAceptada {
  /** `payment_method_id` de Mercado Pago ("visa", "debmaster"): se mapea a la marca canónica en `marcas.ts`. */
  id: string;
  /** "Visa", "Mastercard Débito". */
  nombre: string;
  /** URL https del logo (lo sirve Mercado Pago). */
  logo: string;
}

export interface TarjetasAceptadas {
  credito: TarjetaAceptada[];
  debito: TarjetaAceptada[];
}

export const SIN_TARJETAS: TarjetasAceptadas = { credito: [], debito: [] };

/** Lo que nos importa de cada medio de `GET /v1/payment_methods`. */
interface MedioMercadoPago {
  id?: unknown;
  name?: unknown;
  payment_type_id?: unknown;
  status?: unknown;
  secure_thumbnail?: unknown;
}

/** Las más usadas primero; el resto, alfabético. */
const ORDEN = ["visa", "master", "amex", "naranja", "cabal", "debvisa", "debmaster", "maestro", "debcabal"];

const posicion = (id: string) => {
  const i = ORDEN.indexOf(id);
  return i === -1 ? ORDEN.length : i;
};

/**
 * Respuesta cruda de Mercado Pago → tarjetas de crédito y débito ACTIVAS con logo https. Cualquier otra cosa
 * (efectivo, transferencia, prepagas, inactivas, datos incompletos) se descarta: mejor una lista corta que
 * un logo roto.
 */
export function tarjetasDeMercadoPago(respuesta: unknown): TarjetasAceptadas {
  if (!Array.isArray(respuesta)) return SIN_TARJETAS;
  const validas = (respuesta as MedioMercadoPago[]).filter(
    (m): m is { id: string; name: string; payment_type_id: string; status: string; secure_thumbnail: string } =>
      typeof m?.id === "string" &&
      typeof m.name === "string" &&
      m.name.trim() !== "" &&
      m.status === "active" &&
      (m.payment_type_id === "credit_card" || m.payment_type_id === "debit_card") &&
      typeof m.secure_thumbnail === "string" &&
      m.secure_thumbnail.startsWith("https://"),
  );
  const ordenar = (a: { id: string; name: string }, b: { id: string; name: string }) =>
    posicion(a.id) - posicion(b.id) || a.name.localeCompare(b.name, "es");
  const de = (tipo: string) =>
    validas
      .filter((m) => m.payment_type_id === tipo)
      .sort(ordenar)
      .map((m) => ({ id: m.id, nombre: m.name.trim(), logo: m.secure_thumbnail }));
  return { credito: de("credit_card"), debito: de("debit_card") };
}

/**
 * Crédito y débito juntos como logos, sin repetir (algunas marcas usan el mismo logo para los dos): la fila
 * del footer y la tarjeta "Mercado Pago" del checkout.
 */
export function logosTarjetas(t: TarjetasAceptadas): { name: string; src: string }[] {
  return [...t.credito, ...t.debito]
    .filter((x, i, todas) => todas.findIndex((o) => o.logo === x.logo) === i)
    .map((x) => ({ name: x.nombre, src: x.logo }));
}
