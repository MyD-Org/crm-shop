/**
 * Mapa canónico de marcas de tarjeta (change `cuotas-en-el-formulario`, D5). Módulo PURO.
 *
 * El admin guarda en `lista_precio_condiciones.marcas` ids canónicos en minúscula (su lista vive en
 * apps/admin/src/lib/marcas-tarjeta.ts y es un subconjunto de ésta). Acá se traducen los ids de cada
 * procesador a esos canónicos, para decidir si una cuota sin interés vale para la tarjeta cargada.
 *
 * Fuera a propósito: las tarjetas de retail (Nativa, Cencosud, Shopping…) y cualquier id de Mercado
 * Pago no verificado contra `GET /v1/payment_methods`. Una marca desconocida es `null`: sólo se le
 * ofrece 1 pago y las condiciones sin restricción de marcas.
 */
import { claveDeMarcaPayway } from "./payway-estados";

export const MARCAS_TARJETA = [
  { id: "visa", nombre: "Visa" },
  { id: "mastercard", nombre: "Mastercard" },
  { id: "maestro", nombre: "Maestro" },
  { id: "amex", nombre: "American Express" },
  { id: "naranja", nombre: "Naranja" },
  { id: "cabal", nombre: "Cabal" },
  { id: "argencard", nombre: "Argencard" },
  { id: "diners", nombre: "Diners" },
] as const;

export type MarcaTarjeta = (typeof MARCAS_TARJETA)[number]["id"];

const IDS: readonly string[] = MARCAS_TARJETA.map((m) => m.id);
const esConocida = (v: unknown): v is MarcaTarjeta => typeof v === "string" && IDS.includes(v);

/** `payment_method_id` de Mercado Pago (verificados contra /v1/payment_methods) -> canónico. */
const DE_MERCADO_PAGO: Readonly<Record<string, MarcaTarjeta>> = {
  visa: "visa",
  debvisa: "visa",
  master: "mastercard",
  debmaster: "mastercard",
  maestro: "maestro",
  amex: "amex",
  naranja: "naranja",
  cabal: "cabal",
  debcabal: "cabal",
  argencard: "argencard",
  diners: "diners",
};

export function marcaDeMercadoPago(id: string | null | undefined): MarcaTarjeta | null {
  return typeof id === "string" && Object.hasOwn(DE_MERCADO_PAGO, id) ? DE_MERCADO_PAGO[id] : null;
}

/** `payment_method_id` de Payway -> canónico. Las claves de payway-estados ya son canónicas. */
export function marcaDePayway(id: number | string | null | undefined): MarcaTarjeta | null {
  const n = typeof id === "string" && /^\d+$/.test(id) ? Number(id) : id;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  const clave = claveDeMarcaPayway(n);
  return esConocida(clave) ? clave : null;
}

export function nombreDeMarca(id: string): string {
  return MARCAS_TARJETA.find((m) => m.id === id)?.nombre ?? id;
}

/** Una condición sin restricción (null) vale para cualquier tarjeta; con restricción, sólo las incluidas. */
export function marcaPermitida(marcas: readonly string[] | null | undefined, marca: string | null): boolean {
  if (marcas == null) return true;
  return marca !== null && marcas.includes(marca);
}

/**
 * Lee `marcas` del CRM: null o lo que no es arreglo = todas; si no, sólo las conocidas. Una
 * restricción que queda vacía (todas desconocidas) hace la condición inaccesible: no se ofrece.
 */
export function leerMarcas(raw: unknown): { marcas: string[] | null; inaccesible: boolean } {
  if (!Array.isArray(raw)) return { marcas: null, inaccesible: false };
  const marcas = raw.filter(esConocida);
  return { marcas, inaccesible: marcas.length === 0 };
}
