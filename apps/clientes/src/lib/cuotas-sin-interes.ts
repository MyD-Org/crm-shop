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
import type { Cotizacion } from "./cotizacion";

export const CUOTAS_MIN = 2;
export const CUOTAS_MAX = 24;

/** Una condición (medio, N cuotas) del CRM: la lista online cuyo precio se divide en N. */
export interface CondicionCuotas {
  cuotas: number;
  /** uuid de la lista online (coincide con `idPriceList` de los precios de la vista del catálogo). */
  idListaPrecios: string;
  /**
   * Mínimo CON impuestos (`monto_minimo` del CRM) desde el que se ofrece esta cantidad. Se compara
   * contra la base: el total a la lista del PAGO ÚNICO del medio. null o ausente = sin mínimo.
   */
  montoMinimo?: number | null;
}

/** El medio de pago que cobra en cuotas, con sus condiciones. Serializable: viaja al cliente. */
export interface MedioCuotas {
  slug: string;
  nombre: string;
  condiciones: CondicionCuotas[];
  /**
   * Lista del pago único del medio (la base del mínimo). null o ausente: rige la de referencia,
   * como en la cotización.
   */
  idListaPagoUnico?: string | null;
}

/** Una cantidad de cuotas ofrecida para un precio concreto. */
export interface OpcionCuotas {
  cuotas: number;
  /** Total de la lista de esa cantidad de cuotas, con IVA: lo que se cobra en total. */
  total: number;
  /** Monto por cuota: total / N redondeado al centavo HACIA ARRIBA (ver `montoPorCuota`). */
  montoCuota: number;
  /** Siempre true: el modelo no tiene cuotas con interés. */
  sinInteres: true;
}

const aCentavos = (n: number) => Math.round(n * 100);
const deCentavos = (c: number) => c / 100;

const esCuotasValidas = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= CUOTAS_MIN && n <= CUOTAS_MAX;

/**
 * Monto por cuota que se EXHIBE: total / N redondeado al centavo hacia arriba (100,00 en 3 = 33,34).
 * Es sólo informativo: el cobro es el total congelado y el banco decide dónde van los centavos. Se
 * calcula en centavos enteros. Cantidad inválida o 1 = el total.
 */
export function montoPorCuota(total: number, cuotas: number | null): number {
  const centavos = Number.isFinite(total) && total > 0 ? aCentavos(total) : 0;
  if (centavos === 0 || cuotas === null || !Number.isInteger(cuotas) || cuotas < 2) return deCentavos(centavos);
  return deCentavos(Math.ceil(centavos / cuotas));
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
 * Las condiciones que se ofrecen para una `base`: la cotización del pedido (con impuestos) a la lista
 * del PAGO ÚNICO del medio. Una condición con `montoMinimo` mayor que la base queda afuera; la
 * igualdad aplica. Compara en centavos enteros (sin ruido de coma flotante). Una base inválida
 * (NaN, negativa) cuenta como 0: las condiciones sin mínimo siguen, las que lo tienen no.
 */
export function condicionesAplicables(
  condiciones: readonly CondicionCuotas[] | null | undefined,
  base: number,
): CondicionCuotas[] {
  const baseCentavos = Number.isFinite(base) && base > 0 ? aCentavos(base) : 0;
  return condicionesValidas(condiciones).filter(
    (c) => c.montoMinimo == null || !(aCentavos(c.montoMinimo) > baseCentavos),
  );
}

/**
 * La próxima cantidad de cuotas que se habilitaría subiendo la compra: entre las condiciones con
 * mínimo que la `base` todavía no alcanza, la de menor mínimo, y cuánto falta (a dos decimales).
 * null si no queda ninguna.
 */
export function proximoEscalon(
  condiciones: readonly CondicionCuotas[] | null | undefined,
  base: number,
): { cuotas: number; falta: number } | null {
  const baseCentavos = Number.isFinite(base) && base > 0 ? aCentavos(base) : 0;
  let mejor: { cuotas: number; minimo: number } | null = null;
  for (const c of condicionesValidas(condiciones)) {
    if (c.montoMinimo == null) continue;
    const minimo = aCentavos(c.montoMinimo);
    if (minimo > baseCentavos && (!mejor || minimo < mejor.minimo)) mejor = { cuotas: c.cuotas, minimo };
  }
  return mejor ? { cuotas: mejor.cuotas, falta: deCentavos(mejor.minimo - baseCentavos) } : null;
}

/**
 * Opciones de cuotas de UN producto: una por condición, con el total de la lista enlazada. Sin IVA
 * conocido, sin medio o sin precio válido en la lista no hay opción: nunca se inventa un monto.
 * El mínimo se compara contra el precio UNITARIO con impuestos a la lista del pago único del medio:
 * es informativo (el carrito, con cantidad, puede alcanzar más escalones que la ficha).
 */
export function opcionesCuotas(
  prices: AlegraPrice[] | undefined,
  ivaPorcentaje: number | null | undefined,
  medio: MedioCuotas | null | undefined,
): OpcionCuotas[] {
  if (!medio || !Array.isArray(prices) || prices.length === 0) return [];
  const salida: OpcionCuotas[] = [];
  const baseUnitaria = precioFinal(precioDeLista(prices, medio.idListaPagoUnico ?? undefined), ivaPorcentaje) ?? 0;
  for (const c of condicionesAplicables(medio.condiciones, baseUnitaria)) {
    const total = precioFinal(precioDeLista(prices, c.idListaPrecios), ivaPorcentaje);
    if (total === undefined) continue;
    salida.push({ cuotas: c.cuotas, total, montoCuota: montoPorCuota(total, c.cuotas), sinInteres: true });
  }
  return salida;
}

/** Una cantidad de cuotas que el producto NO alcanza por el monto mínimo, con ese mínimo (con impuestos). */
export interface CuotaNoAlcanzada {
  cuotas: number;
  minimo: number;
}

/**
 * Las cantidades de cuotas de UN medio que el precio unitario del producto no alcanza por mínimo
 * (informativo). Misma base que `opcionesCuotas`; sin precio válido en la lista no se inventan.
 */
export function cuotasNoAlcanzadas(
  prices: AlegraPrice[] | undefined,
  ivaPorcentaje: number | null | undefined,
  medio: MedioCuotas | null | undefined,
): CuotaNoAlcanzada[] {
  if (!medio || !Array.isArray(prices) || prices.length === 0) return [];
  const baseUnitaria = precioFinal(precioDeLista(prices, medio.idListaPagoUnico ?? undefined), ivaPorcentaje) ?? 0;
  const aplican = new Set(condicionesAplicables(medio.condiciones, baseUnitaria).map((c) => c.cuotas));
  const salida: CuotaNoAlcanzada[] = [];
  for (const c of condicionesValidas(medio.condiciones)) {
    if (aplican.has(c.cuotas) || c.montoMinimo == null) continue;
    if (precioFinal(precioDeLista(prices, c.idListaPrecios), ivaPorcentaje) === undefined) continue;
    salida.push({ cuotas: c.cuotas, minimo: c.montoMinimo });
  }
  return salida;
}

/** Las opciones de UN medio de cobro para un producto. */
export interface CuotasDeMedio {
  slug: string;
  /** Nombre del medio tal cual lo carga el operador en el admin ("Mercado Pago"). */
  medio: string;
  opciones: OpcionCuotas[];
  /** Cantidades que el producto no alcanza por mínimo (el modal las muestra atenuadas). */
  noAlcanzadas?: CuotaNoAlcanzada[];
}

/** Las cuotas de un producto: un bloque por medio elegible, en el orden del admin. Viaja con el `Product`. */
export interface CuotasProducto {
  medios: CuotasDeMedio[];
}

/** La de mayor cantidad de cuotas; a igual cantidad, la de menor cuota. */
export function mejorOpcionCuotas(opciones: readonly OpcionCuotas[] | null | undefined): OpcionCuotas | null {
  let mejor: OpcionCuotas | null = null;
  for (const o of opciones ?? []) {
    if (!mejor || o.cuotas > mejor.cuotas || (o.cuotas === mejor.cuotas && o.montoCuota < mejor.montoCuota)) mejor = o;
  }
  return mejor;
}

/** La mejor opción entre TODOS los medios (card y línea de la ficha). */
export function mejorCuotaProducto(cuotas: CuotasProducto | null | undefined): OpcionCuotas | null {
  return mejorOpcionCuotas((cuotas?.medios ?? []).flatMap((m) => m.opciones));
}

/**
 * Las filas del modal: una por cada cantidad de cuotas ofrecida por CUALQUIER medio, ascendentes.
 * Si dos medios ofrecen la misma cantidad se queda la de menor total (y, a igual total, menor cuota).
 */
export function opcionesCombinadas(cuotas: CuotasProducto | null | undefined): OpcionCuotas[] {
  const porCantidad = new Map<number, OpcionCuotas>();
  for (const m of cuotas?.medios ?? []) {
    for (const o of m.opciones) {
      const actual = porCantidad.get(o.cuotas);
      if (!actual || o.total < actual.total || (o.total === actual.total && o.montoCuota < actual.montoCuota)) {
        porCantidad.set(o.cuotas, o);
      }
    }
  }
  return [...porCantidad.values()].sort((a, b) => a.cuotas - b.cuotas);
}

/**
 * Filas atenuadas del modal: cantidades que ningún medio ofrece para el producto, con el menor
 * mínimo entre medios. Ascendentes.
 */
export function filasNoAlcanzadas(cuotas: CuotasProducto | null | undefined): CuotaNoAlcanzada[] {
  const ofrecidas = new Set(opcionesCombinadas(cuotas).map((o) => o.cuotas));
  const porCantidad = new Map<number, number>();
  for (const m of cuotas?.medios ?? []) {
    for (const n of m.noAlcanzadas ?? []) {
      if (ofrecidas.has(n.cuotas)) continue;
      const actual = porCantidad.get(n.cuotas);
      if (actual === undefined || n.minimo < actual) porCantidad.set(n.cuotas, n.minimo);
    }
  }
  return [...porCantidad.entries()].map(([c, minimo]) => ({ cuotas: c, minimo })).sort((a, b) => a.cuotas - b.cuotas);
}

/** ¿El modal de medios de pago tiene algo que mostrar? Alguna opción alcanzada o alguna fila atenuada. */
export function hayCuotasParaModal(cuotas: CuotasProducto | null | undefined): boolean {
  return mejorCuotaProducto(cuotas) !== null || filasNoAlcanzadas(cuotas).length > 0;
}

/** Progreso hacia la próxima cantidad de cuotas (barra del carrito). Serializable. */
export interface ProgresoCuotas {
  /** La mayor cantidad de cuotas que la compra ya tiene (cualquier medio); null si ninguna. */
  cuotasActuales: number | null;
  /** El escalón más cercano por encima de la compra; null = ya está en el más alto. */
  proximo: { cuotas: number; falta: number; minimo: number } | null;
  /** 0..100: base / mínimo del próximo escalón (100 si no hay próximo). */
  pct: number;
  /**
   * Monto de cada cuota de `cuotasActuales`: total de la compra a la lista de esa condición dividido
   * N (ver `montoPorCuota`). Lo agrega el servidor; ausente = no se pudo calcular (sólo se informa la
   * cantidad de cuotas, nunca un monto inventado).
   */
  montoCuota?: number;
  /**
   * Sólo si el pedido lo pide (`precioLineas`, la ficha): las líneas de la cotización a la lista de
   * la condición alcanzada (total con impuestos de cada una), para que la ficha calcule la cuota de
   * SU producto. Ausente = no se pidió o no se pudo cotizar.
   */
  lineasAlcanzada?: { id: string; qty: number; total: number }[];
}

/**
 * La condición que sostiene `cuotasActuales`: la de esa cantidad de cuotas que alcanza su base (la
 * primera de los medios, en orden). Su lista de precios es la de la que sale el monto por cuota.
 */
export function condicionAlcanzada(
  medios: readonly { condiciones: readonly CondicionCuotas[] | null | undefined; base: number }[],
  cuotas: number | null,
): CondicionCuotas | null {
  if (cuotas === null) return null;
  for (const m of medios) {
    const c = condicionesAplicables(m.condiciones, m.base).find((x) => x.cuotas === cuotas);
    if (c) return c;
  }
  return null;
}

/**
 * Progreso combinado entre medios elegibles: cada uno con su `base` (total con impuestos a la lista
 * del pago único del medio). El próximo escalón es el de menor falta entre los que mejoran la mayor
 * cantidad ya alcanzada. null = ningún medio tiene mínimos: no hay barra que mostrar.
 */
export function progresoCuotas(
  medios: readonly { condiciones: readonly CondicionCuotas[] | null | undefined; base: number }[],
): ProgresoCuotas | null {
  let hayMinimos = false;
  let actuales = 0;
  for (const m of medios) {
    if (condicionesValidas(m.condiciones).some((c) => c.montoMinimo != null)) hayMinimos = true;
    for (const c of condicionesAplicables(m.condiciones, m.base)) actuales = Math.max(actuales, c.cuotas);
  }
  if (!hayMinimos) return null;
  let mejor: { cuotas: number; minimo: number; falta: number } | null = null;
  for (const m of medios) {
    const baseC = Number.isFinite(m.base) && m.base > 0 ? aCentavos(m.base) : 0;
    for (const c of condicionesValidas(m.condiciones)) {
      if (c.montoMinimo == null || c.cuotas <= actuales) continue;
      const minimo = aCentavos(c.montoMinimo);
      if (minimo <= baseC) continue;
      const falta = minimo - baseC;
      if (!mejor || falta < mejor.falta || (falta === mejor.falta && c.cuotas > mejor.cuotas)) {
        mejor = { cuotas: c.cuotas, minimo, falta };
      }
    }
  }
  const cuotasActuales = actuales > 0 ? actuales : null;
  if (!mejor) return { cuotasActuales, proximo: null, pct: 100 };
  const baseDelMejor = mejor.minimo - mejor.falta;
  return {
    cuotasActuales,
    proximo: { cuotas: mejor.cuotas, falta: deCentavos(mejor.falta), minimo: deCentavos(mejor.minimo) },
    pct: Math.max(0, Math.min(100, Math.floor((baseDelMejor / mejor.minimo) * 100))),
  };
}

/**
 * Cantidad de cuotas que el servidor acepta de lo que mandó el navegador: ausente o 1 = un pago;
 * N >= 2 sólo si hay una condición para esa cantidad. Cualquier otra cosa (string, decimal, 0,
 * negativo, cantidad sin condición) se rechaza: el comprador no inventa cuotas.
 */
export function cuotasElegidas(
  entrada: unknown,
  condiciones: readonly CondicionCuotas[] | null | undefined,
  /**
   * Total con impuestos a la lista del pago único (ver `condicionesAplicables`). Si se pasa, una
   * cantidad cuyo mínimo no alcanza se rechaza. Sin base (undefined) no se mira el mínimo: lo
   * hacen valer los dos llamadores del servidor, que siempre la pasan.
   */
  base?: number,
): { ok: true; cuotas: number } | { ok: false } {
  if (entrada === undefined || entrada === null) return { ok: true, cuotas: 1 };
  if (typeof entrada !== "number" || !Number.isInteger(entrada) || entrada < 1) return { ok: false };
  if (entrada === 1) return { ok: true, cuotas: 1 };
  const ofrecidas = base === undefined ? condicionesValidas(condiciones) : condicionesAplicables(condiciones, base);
  return ofrecidas.some((c) => c.cuotas === entrada) ? { ok: true, cuotas: entrada } : { ok: false };
}

/** La lista que rige para esa cantidad de cuotas; `undefined` para un pago o sin condición. */
export function idListaDeCuotas(
  condiciones: readonly CondicionCuotas[] | null | undefined,
  cuotas: number | null | undefined,
): string | undefined {
  if (typeof cuotas !== "number" || cuotas < CUOTAS_MIN) return undefined;
  return condicionesValidas(condiciones).find((c) => c.cuotas === cuotas)?.idListaPrecios;
}

/**
 * Base para los mínimos de cuotas a partir de una cotización: el total con impuestos de las líneas
 * con precio. Un problema de STOCK no la anula (el carrito sigue teniendo precio; el bloqueo de la
 * compra es otro tema), pero una línea sin precio, inactiva o inexistente la vuelve incalculable:
 * null. Nunca devuelve 0: con base desconocida no se promete nada (sin barra).
 */
export function baseParaCuotas(c: Pick<Cotizacion, "lineas" | "hayProblemas" | "total" | "costoEnvio">): number | null {
  let total = c.total;
  if (c.hayProblemas) {
    if (c.lineas.some((l) => l.problema && l.problema !== "sin_stock" && l.problema !== "stock_insuficiente")) return null;
    total = deCentavos(c.lineas.reduce((a, l) => a + aCentavos(l.total), 0) + aCentavos(c.costoEnvio));
  }
  return Number.isFinite(total) && total > 0 ? total : null;
}
