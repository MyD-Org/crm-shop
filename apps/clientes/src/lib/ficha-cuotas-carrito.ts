/**
 * Cuotas de la ficha "con su carrito": cómo queda la compra si se suma este producto a lo que ya
 * hay en el carrito. Módulo puro: arma las líneas hipotéticas (el carrito no se modifica) y la meta
 * que se dibuja con `MetasCarrito`. La cotización la hace el servidor, con la misma regla del carrito.
 */
import type { ProgresoCuotas } from "./cuotas-sin-interes";
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

/** Sin progreso o sin cuotas que informar: null. Si la compra ya tiene cuotas, se informa eso; si no, cuánto falta. */
export function metaCuotasFicha(p: ProgresoCuotas | null | undefined): MetaCarrito | null {
  if (!p) return null;
  if (p.cuotasActuales !== null && p.montoCuota != null) {
    const ya = TEXTOS_CUOTAS.fichaYaTiene(p.cuotasActuales, p.montoCuota);
    if (!p.proximo) {
      return { id: "cuotas", texto: ya, pct: 100, alcanzada: true, aria: TEXTOS_CUOTAS.barraAria };
    }
    return {
      id: "cuotas",
      texto: TEXTOS_CUOTAS.faltaParaCuotas(p.proximo.falta, p.proximo.cuotas),
      enfasis: TEXTOS_CUOTAS.montoFaltante(p.proximo.falta),
      textoAlcanzado: ya,
      enfasisAlcanzado: TEXTOS_CUOTAS.cuotasConMonto(p.cuotasActuales, p.montoCuota),
      pct: p.pct,
      alcanzada: false,
      aria: TEXTOS_CUOTAS.barraAria,
    };
  }
  if (p.cuotasActuales !== null) {
    return {
      id: "cuotas",
      texto: TEXTOS_CUOTAS.fichaEntraEnCuotas(p.cuotasActuales),
      enfasis: TEXTOS_CUOTAS.cantidadCuotas(p.cuotasActuales),
      pct: 100,
      alcanzada: true,
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
