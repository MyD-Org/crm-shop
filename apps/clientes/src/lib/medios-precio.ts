/**
 * "$X con <Medio>" del catálogo y la ficha. Lógica PURA, sin base ni flags.
 *
 * - Cards (catálogo, carruseles, favoritos): sólo el medio DESTACADO (`destacarEnCatalogo`).
 * - Ficha: una línea por cada medio con `mostrarEnFicha`, en el orden del operador.
 * Un medio cuenta si está activo y tiene lista de precios enlazada; la línea de un producto sólo
 * aparece si su precio en esa lista es MENOR que el de la lista por defecto (misma regla que la
 * cotización: `precioDeLista`), así lo que se exhibe coincide con lo que cotiza el checkout.
 */
import { precioDeLista, precioGeneral, type AlegraPrice } from "./alegra";
import type { PrecioMedio } from "@/data/products";
import { opcionesCuotas, type CuotasProducto, type MedioCuotas } from "./cuotas-sin-interes";
import { SLUGS_RESERVADOS, type MedioPago } from "./medios-pago";
import { precioFinal } from "./precio-final";

/** Un medio a exhibir con precio: lo mínimo que viaja a las funciones cacheadas (parte de la clave). */
export interface MedioPrecio {
  slug: string;
  nombre: string;
  idListaPrecios: string;
}

export interface MediosPrecio {
  /** Medio de las cards; `null` = ninguno. */
  destacado: MedioPrecio | null;
  /** Medios de la ficha, ya ordenados. */
  ficha: MedioPrecio[];
  /**
   * Cuotas sin interés (rebanada D, con el flag `cuotas-cobro`): el medio de cobro en línea y sus
   * condiciones. Ausente = no hay cuotas que mostrar. Es parte de la clave de las cachés.
   */
  cuotas?: MedioCuotas;
}

export const SIN_MEDIOS_PRECIO: MediosPrecio = { destacado: null, ficha: [] };

function porOrden(a: MedioPago, b: MedioPago): number {
  return a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es") || a.slug.localeCompare(b.slug);
}

/**
 * Qué medios exhibir. Con el flag `precio-especial-cuenta` ENCENDIDO el precio vuelve a depender de
 * la lista del cliente y no conviven las líneas "con X": vacío.
 */
export function seleccionarMediosPrecio(
  medios: readonly MedioPago[],
  especialEncendido: boolean,
  /** Flag `cuotas-cobro`: sin él no se exhiben cuotas. */
  cuotasEncendido = false,
): MediosPrecio {
  if (especialEncendido) return SIN_MEDIOS_PRECIO;
  const elegibles = medios
    .filter((m) => m.activo && Boolean(m.idListaPrecios) && !SLUGS_RESERVADOS.includes(m.slug))
    .sort(porOrden);
  const aMedio = (m: MedioPago): MedioPrecio => ({ slug: m.slug, nombre: m.nombre, idListaPrecios: m.idListaPrecios as string });
  const destacado = elegibles.find((m) => m.destacarEnCatalogo);
  const cuotas = cuotasEncendido ? medioCuotas(medios) : null;
  return {
    destacado: destacado ? aMedio(destacado) : null,
    ficha: elegibles.filter((m) => m.mostrarEnFicha).map(aMedio),
    ...(cuotas ? { cuotas } : {}),
  };
}

/**
 * El medio que cobra en cuotas: el activo con cobro en línea y condiciones de 2..24 cuotas (el
 * primero por orden). Sin condiciones no hay nada que ofrecer.
 */
function medioCuotas(medios: readonly MedioPago[]): MedioCuotas | null {
  const m = medios
    .filter((x) => x.activo && x.cobroOnline && !SLUGS_RESERVADOS.includes(x.slug) && (x.condicionesCuotas?.length ?? 0) > 0)
    .sort(porOrden)[0];
  if (!m) return null;
  const condiciones = [...(m.condicionesCuotas ?? [])].sort((a, b) => a.cuotas - b.cuotas);
  return { slug: m.slug, nombre: m.nombre, condiciones, idListaPagoUnico: m.idListaPrecios };
}

function precioDelMedio(prices: AlegraPrice[], iva: number | null, medio: MedioPrecio): PrecioMedio | null {
  const general = precioGeneral(prices);
  const price = precioDeLista(prices, medio.idListaPrecios);
  // `precioDeLista` cae al general cuando la lista no aplica: sin descuento no hay línea.
  if (!(price > 0) || price >= general) return null;
  const final = precioFinal(price, iva);
  return { slug: medio.slug, nombre: medio.nombre, price, ...(final != null ? { precioFinal: final } : {}) };
}

/**
 * `precioMedio` (card) y `preciosMedios` (ficha) de un producto. Sin `medios` no suma ningún campo;
 * `preciosMedios` queda definido (posiblemente vacío) apenas se pasan medios.
 */
export function armarPreciosMedios(
  prices: AlegraPrice[],
  iva: number | null,
  medios: MediosPrecio | undefined,
): { precioMedio?: PrecioMedio; preciosMedios?: PrecioMedio[]; cuotasSinInteres?: CuotasProducto } {
  if (!medios) return {};
  const precioMedio = medios.destacado ? precioDelMedio(prices, iva, medios.destacado) : null;
  const preciosMedios = medios.ficha.flatMap((m) => precioDelMedio(prices, iva, m) ?? []);
  const opciones = opcionesCuotas(prices, iva, medios.cuotas);
  return {
    ...(precioMedio ? { precioMedio } : {}),
    preciosMedios,
    ...(medios.cuotas && opciones.length > 0 ? { cuotasSinInteres: { medio: medios.cuotas.nombre, opciones } } : {}),
  };
}
