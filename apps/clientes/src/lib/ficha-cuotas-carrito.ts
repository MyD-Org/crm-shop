/**
 * Cuotas de la ficha "con su carrito": cómo queda la compra si se suma este producto a lo que ya
 * hay en el carrito. Módulo puro: arma las líneas hipotéticas (el carrito no se modifica) y la meta
 * que se dibuja con `MetasCarrito`. La cotización la hace el servidor, con la misma regla del carrito.
 */
import {
  filasNoAlcanzadas,
  mejorCuotaProducto,
  type CuotaNoAlcanzada,
  montoPorCuota,
  type CuotasProducto,
  type OpcionCuotas,
  type ProgresoCuotas,
} from "./cuotas-sin-interes";
import { TEXTOS_CUOTAS } from "./cuotas-textos";
import type { MetaCarrito } from "./metas-carrito";

export interface LineaHipotetica {
  id: string;
  qty: number;
}

/**
 * Líneas del carrito más este producto (la cantidad se suma si ya estaba). Carrito vacío: null, la
 * ficha se queda como está y no se cotiza nada.
 */
export function lineasConProducto(
  carrito: readonly LineaHipotetica[],
  id: string,
  qty: number,
): LineaHipotetica[] | null {
  if (carrito.length === 0) return null;
  const cant = Number.isFinite(qty) && qty >= 1 ? Math.floor(qty) : 1;
  const lineas = carrito.map((l) => (l.id === id ? { id: l.id, qty: l.qty + cant } : { id: l.id, qty: l.qty }));
  if (!lineas.some((l) => l.id === id)) lineas.push({ id, qty: cant });
  return lineas;
}

/** Lo que la línea verde y el modal de la ficha dicen cuando el carrito sube el nivel de cuotas. */
export interface CuotasFichaCarrito {
  cuotas: number;
  /** Total DE ESTE PRODUCTO (por la cantidad elegida) a la lista de la condición alcanzada. */
  total: number;
  /** `total` / `cuotas`, redondeado como en el resto de la tienda (`montoPorCuota`). */
  montoCuota: number;
}

/**
 * Si con el carrito la compra alcanza un nivel MAYOR que el del producto solo, ese nivel con el
 * monto de ESTE producto (precio a la lista alcanzada × cantidad elegida ÷ cuotas). El precio sale
 * de la línea del producto en la cotización de esa lista; si el servidor no la trajo, se usa el
 * precio de la lista de `soloProducto` (la que ya muestra la línea). Sin ninguno: null (no se
 * inventa un monto). Sin progreso o sin nivel mayor: null.
 */
export function cuotasFichaConCarrito(
  p: ProgresoCuotas | null | undefined,
  productoId: string,
  qty: number,
  soloProducto: OpcionCuotas | null | undefined,
): CuotasFichaCarrito | null {
  if (!p || p.cuotasActuales === null || p.cuotasActuales <= (soloProducto?.cuotas ?? 0)) return null;
  const cant = Number.isFinite(qty) && qty >= 1 ? Math.floor(qty) : 1;
  const linea = p.lineasAlcanzada?.find((l) => l.id === productoId && l.qty > 0 && l.total > 0);
  const unitario = linea ? linea.total / linea.qty : soloProducto?.total;
  if (unitario === undefined || !(unitario > 0)) return null;
  const total = Math.round(unitario * cant * 100) / 100;
  return { cuotas: p.cuotasActuales, total, montoCuota: montoPorCuota(total, p.cuotasActuales) };
}

/**
 * Recuadro de la ficha (la barra). Sólo habla de lo que FALTA: lo que la compra ya tiene lo dice la
 * línea verde (`cuotasFichaConCarrito`), así no se repite ni se contradice.
 * - `nivelMayor` (la línea ya muestra un nivel subido por el carrito): sólo si hay un nivel más alto,
 *   "Sume $Y más y pague en 12 cuotas sin interés."; si no hay más, nada.
 * - Si no: "Con su carrito y este producto, sume $Y más…" cuando falta algo; si no, nada.
 */
export function metaCuotasFicha(p: ProgresoCuotas | null | undefined, nivelMayor = false): MetaCarrito | null {
  if (!p?.proximo) return null;
  return {
    id: "cuotas",
    texto: nivelMayor
      ? TEXTOS_CUOTAS.faltaParaCuotas(p.proximo.falta, p.proximo.cuotas)
      : TEXTOS_CUOTAS.fichaFaltaParaCuotas(p.proximo.falta, p.proximo.cuotas),
    enfasis: TEXTOS_CUOTAS.montoFaltante(p.proximo.falta),
    pct: p.pct,
    alcanzada: false,
    aria: TEXTOS_CUOTAS.barraAria,
  };
}

/**
 * Texto secundario de la ficha, debajo de la línea de cuotas del producto: la MAYOR cantidad de
 * cuotas que ofrece algún medio y que el producto solo no alcanza por mínimo, con ese mínimo (el
 * menor entre medios). Sale sólo de los datos públicos del producto (sirve en la ficha cacheada).
 * null si no hay un nivel mayor que el que ya tiene el producto o si ese nivel no tiene mínimo.
 */
export function cuotasHastaFicha(cuotas: CuotasProducto | null | undefined): CuotaNoAlcanzada | null {
  const actual = mejorCuotaProducto(cuotas)?.cuotas ?? 0;
  let mayor: CuotaNoAlcanzada | null = null;
  for (const f of filasNoAlcanzadas(cuotas)) {
    if (f.cuotas > actual && (!mayor || f.cuotas > mayor.cuotas)) mayor = f;
  }
  return mayor;
}
