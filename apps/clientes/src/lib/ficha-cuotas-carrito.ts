/**
 * Cuotas de la ficha "con su carrito": cómo queda la compra si se suma este producto a lo que ya
 * hay en el carrito. Módulo puro: arma las líneas hipotéticas (el carrito no se modifica) y la meta
 * que se dibuja con `MetasCarrito`. La cotización la hace el servidor, con la misma regla del carrito.
 */
import {
  filasNoAlcanzadas,
  mejorCuotaProducto,
  type CuotaNoAlcanzada,
  type CuotasProducto,
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

/**
 * Recuadro de la ficha. Sin progreso o sin cuotas que informar: null. Si la compra ya alcanza un
 * nivel, se dice cuál (sin el monto de la cuota de toda la compra: la línea de arriba es la del
 * producto) y, si hay uno más alto, cuánto falta. Si no alcanza ninguno, cuánto falta.
 */
export function metaCuotasFicha(p: ProgresoCuotas | null | undefined): MetaCarrito | null {
  if (!p) return null;
  if (p.cuotasActuales !== null) {
    if (!p.proximo) {
      return {
        id: "cuotas",
        texto: TEXTOS_CUOTAS.fichaCompraYaTiene(p.cuotasActuales),
        enfasis: TEXTOS_CUOTAS.cuotasSinInteres(p.cuotasActuales),
        pct: 100,
        alcanzada: true,
        aria: TEXTOS_CUOTAS.barraAria,
      };
    }
    return {
      id: "cuotas",
      texto: TEXTOS_CUOTAS.faltaParaCuotas(p.proximo.falta, p.proximo.cuotas),
      enfasis: TEXTOS_CUOTAS.montoFaltante(p.proximo.falta),
      textoAlcanzado: TEXTOS_CUOTAS.fichaYaTieneCuotas(p.cuotasActuales),
      enfasisAlcanzado: TEXTOS_CUOTAS.cuotasSinInteres(p.cuotasActuales),
      pct: p.pct,
      alcanzada: false,
      aria: TEXTOS_CUOTAS.barraAria,
    };
  }
  if (!p.proximo) return null;
  return {
    id: "cuotas",
    texto: TEXTOS_CUOTAS.fichaFaltaParaCuotas(p.proximo.falta, p.proximo.cuotas),
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
