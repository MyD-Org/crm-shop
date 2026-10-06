/**
 * Cuotas SIN INTERÉS por lista de precios (change `listas-precio-online`, rebanada D).
 *
 * Modelo: el costo financiero lo absorbe la tienda y ya está dentro del coeficiente de la lista.
 * Una condición (medio de pago, N cuotas) del CRM apunta a una lista de precios online; la cuota
 * es el total de ESA lista (con IVA) dividido N. No hay recargo, ni "total con recargo", ni CFT/TEA.
 *
 * Módulo PURO (sin base ni flags): lo usan la exhibición (card, ficha, modal), el checkout (selector)
 * y el servidor (validación del pedido), así lo que se muestra y lo que se acepta son lo mismo.
 * El precio de cada lista se resuelve con `precioDeLista`, la MISMA regla que la cotización: una
 * lista que no es menor que la general cae a la general.
 */
import { precioDeLista, type AlegraPrice } from "./alegra";
import { precioFinal } from "./precio-final";

export const CUOTAS_MIN = 2;
export const CUOTAS_MAX = 24;

/** Una condición (medio, N cuotas) del CRM: la lista online cuyo precio se divide en N. */
export interface CondicionCuotas {
  cuotas: number;
  /** uuid de la lista online (coincide con `idPriceList` de los precios de la vista del catálogo). */
  idListaPrecios: string;
}

/** El medio de pago que cobra en cuotas, con sus condiciones. Serializable: viaja al cliente. */
export interface MedioCuotas {
  slug: string;
  nombre: string;
  condiciones: CondicionCuotas[];
}

/** Una cantidad de cuotas ofrecida para un precio concreto. */
export interface OpcionCuotas {
  cuotas: number;
  /** Total de la lista de esa cantidad de cuotas, con IVA: lo que se cobra en total. */
  total: number;
  /** Cuota común (la de las últimas N-1 cuotas). */
  montoCuota: number;
  /** Primera cuota: absorbe el resto de centavos. Igual a `montoCuota` si el total divide exacto. */
  primeraCuota: number;
  /** Siempre true: el modelo no tiene cuotas con interés. */
  sinInteres: true;
}

const aCentavos = (n: number) => Math.round(n * 100);
const deCentavos = (c: number) => c / 100;

const esCuotasValidas = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= CUOTAS_MIN && n <= CUOTAS_MAX;

/**
 * Reparte `total` en `cuotas` partes SIN recargo. La suma es exactamente el total y el resto de
 * centavos va a la PRIMERA cuota (100,00 en 3 = 33,34 + 33,33 + 33,33). Cantidad inválida o 1 = un
 * solo pago.
 */
export function repartirCuotas(total: number, cuotas: number | null): number[] {
  const centavos = Number.isFinite(total) && total > 0 ? aCentavos(total) : 0;
  if (centavos === 0 || cuotas === null || !Number.isInteger(cuotas) || cuotas < 2) return [deCentavos(centavos)];
  const base = Math.floor(centavos / cuotas);
  const resto = centavos - base * cuotas;
  return Array.from({ length: cuotas }, (_, i) => deCentavos(i === 0 ? base + resto : base));
}

/** Condiciones utilizables: 2..24 cuotas, con lista y sin repetir cantidad (gana la primera), ascendentes. */
function condicionesValidas(condiciones: readonly CondicionCuotas[] | null | undefined): CondicionCuotas[] {
  const vistas = new Set<number>();
  const salida: CondicionCuotas[] = [];
  for (const c of condiciones ?? []) {
    if (!c || !esCuotasValidas(c.cuotas) || !c.idListaPrecios || vistas.has(c.cuotas)) continue;
    vistas.add(c.cuotas);
    salida.push(c);
  }
  return salida.sort((a, b) => a.cuotas - b.cuotas);
}

/**
 * Opciones de cuotas de UN producto: una por condición, con el total de la lista enlazada. Sin IVA
 * conocido, sin medio o sin precio válido en la lista no hay opción: nunca se inventa un monto.
 */
export function opcionesCuotas(
  prices: AlegraPrice[] | undefined,
  ivaPorcentaje: number | null | undefined,
  medio: MedioCuotas | null | undefined,
): OpcionCuotas[] {
  if (!medio || !Array.isArray(prices) || prices.length === 0) return [];
  const salida: OpcionCuotas[] = [];
  for (const c of condicionesValidas(medio.condiciones)) {
    const total = precioFinal(precioDeLista(prices, c.idListaPrecios), ivaPorcentaje);
    if (total === undefined) continue;
    const partes = repartirCuotas(total, c.cuotas);
    salida.push({
      cuotas: c.cuotas,
      total,
      montoCuota: partes[partes.length - 1],
      primeraCuota: partes[0],
      sinInteres: true,
    });
  }
  return salida;
}

/** Las cuotas de un producto: el medio que las cobra y una opción por cantidad. Viaja con el `Product`. */
export interface CuotasProducto {
  /** Nombre del medio ("Mercado Pago"), para los textos. */
  medio: string;
  opciones: OpcionCuotas[];
}

/** La de mayor cantidad de cuotas (la que se destaca en la card). */
export function mejorOpcionCuotas(opciones: readonly OpcionCuotas[] | null | undefined): OpcionCuotas | null {
  let mejor: OpcionCuotas | null = null;
  for (const o of opciones ?? []) if (!mejor || o.cuotas > mejor.cuotas) mejor = o;
  return mejor;
}

/**
 * Cantidad de cuotas que el servidor acepta de lo que mandó el navegador: ausente o 1 = un pago;
 * N >= 2 sólo si hay una condición para esa cantidad. Cualquier otra cosa (string, decimal, 0,
 * negativo, cantidad sin condición) se rechaza: el comprador no inventa cuotas.
 */
export function cuotasElegidas(
  entrada: unknown,
  condiciones: readonly CondicionCuotas[] | null | undefined,
): { ok: true; cuotas: number } | { ok: false } {
  if (entrada === undefined || entrada === null) return { ok: true, cuotas: 1 };
  if (typeof entrada !== "number" || !Number.isInteger(entrada) || entrada < 1) return { ok: false };
  if (entrada === 1) return { ok: true, cuotas: 1 };
  return condicionesValidas(condiciones).some((c) => c.cuotas === entrada) ? { ok: true, cuotas: entrada } : { ok: false };
}

/** La lista que rige para esa cantidad de cuotas; `undefined` para un pago o sin condición. */
export function idListaDeCuotas(
  condiciones: readonly CondicionCuotas[] | null | undefined,
  cuotas: number | null | undefined,
): string | undefined {
  if (typeof cuotas !== "number" || cuotas < CUOTAS_MIN) return undefined;
  return condicionesValidas(condiciones).find((c) => c.cuotas === cuotas)?.idListaPrecios;
}
