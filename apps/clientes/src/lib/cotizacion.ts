/**
 * Cotización del carrito. El único lugar donde se calcula un total.
 *
 * REGLA CENTRAL: el precio, el IVA y el stock los resuelve el SERVIDOR leyendo
 * EN VIVO de Alegra. El navegador manda `{ id, qty }` y nada más.
 *
 * Dos razones, y las dos son duras:
 * 1. Seguridad. Si el precio viaja desde el cliente, el precio se edita desde
 *    el cliente. No hay validación parcial que arregle eso.
 * 2. Arquitectura. docs/arquitectura-integraciones.md: lo que el shop
 *    COMPROMETE no sale del espejo local, que puede tener hasta 24 h de atraso.
 *
 * SOLO servidor: importa el cliente de Alegra con credenciales.
 */

import {
  getItem,
  ivaDeItem,
  marcaDeCustomFields,
  resolverPrecio,
  type AlegraItem,
} from "./alegra";
import { costoEnvio, type EntregaTipo } from "./envio";

/** Lo único que el cliente tiene derecho a elegir. */
export interface LineaPedida {
  id: string;
  qty: number;
}

export type ProblemaLinea =
  | "no_encontrado"
  | "inactivo"
  | "sin_stock"
  | "stock_insuficiente"
  | "sin_precio";

export interface LineaCotizada {
  id: string;
  code: string | null;
  name: string;
  brand: string;
  qty: number;
  /** Unitario SIN IVA. */
  precioUnitario: number;
  ivaPorcentaje: number;
  subtotal: number;
  iva: number;
  total: number;
  /** null = ítem no inventariable (servicio): siempre disponible. */
  stockDisponible: number | null;
  problema?: ProblemaLinea;
  /** Texto listo para mostrar cuando hay `problema`. */
  detalle?: string;
}

export interface Cotizacion {
  lineas: LineaCotizada[];
  subtotal: number;
  iva: number;
  costoEnvio: number;
  total: number;
  /** true si alguna línea tiene `problema`: bloquea la confirmación. */
  hayProblemas: boolean;
}

/** Máximo de unidades por línea. Freno a un `qty` absurdo o negativo. */
const QTY_MAX = 9_999;
/** Ítems que se piden a Alegra en paralelo. Mismo criterio que la sync. */
const CONCURRENCIA = 8;
/** Techo de líneas por pedido: acota el fan-out contra Alegra en un request. */
export const MAX_LINEAS = 60;

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * Normaliza y deduplica lo que llegó del browser. Se hace ANTES de tocar la red
 * para no gastar requests a Alegra con basura, y porque dos líneas del mismo id
 * romperían la validación de stock (cada una pasaría por separado).
 */
export function normalizarLineas(raw: unknown): LineaPedida[] {
  if (!Array.isArray(raw)) return [];
  const porId = new Map<string, number>();

  for (const item of raw) {
    const id = String((item as LineaPedida)?.id ?? "").trim();
    const qty = Math.floor(Number((item as LineaPedida)?.qty));
    if (!id || !Number.isFinite(qty) || qty <= 0) continue;
    porId.set(id, Math.min((porId.get(id) ?? 0) + qty, QTY_MAX));
  }

  return [...porId.entries()]
    .slice(0, MAX_LINEAS)
    .map(([id, qty]) => ({ id, qty }));
}

/** Corre `fn` sobre `items` con paralelismo acotado, preservando el orden. */
async function mapConcurrente<T, R>(
  items: T[],
  limite: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limite, items.length) }, worker),
  );
  return out;
}

function lineaRota(
  pedida: LineaPedida,
  problema: ProblemaLinea,
  detalle: string,
): LineaCotizada {
  return {
    id: pedida.id,
    code: null,
    name: "Producto no disponible",
    brand: "",
    qty: pedida.qty,
    precioUnitario: 0,
    ivaPorcentaje: 0,
    subtotal: 0,
    iva: 0,
    total: 0,
    stockDisponible: 0,
    problema,
    detalle,
  };
}

function cotizarItem(
  pedida: LineaPedida,
  item: AlegraItem,
  idPriceList?: string,
): LineaCotizada {
  const categoria = item.itemCategory as { name?: string } | undefined;
  const precioUnitario = redondear(resolverPrecio(item, idPriceList));
  const ivaPorcentaje = ivaDeItem(item);
  const disponible = item.inventory?.availableQuantity;
  const stockDisponible = disponible == null ? null : Number(disponible);

  const subtotal = redondear(precioUnitario * pedida.qty);
  const iva = redondear(subtotal * (ivaPorcentaje / 100));

  const linea: LineaCotizada = {
    id: item.id,
    code: item.reference || null,
    name: item.name,
    brand: marcaDeCustomFields(item.customFields) || categoria?.name || "",
    qty: pedida.qty,
    precioUnitario,
    ivaPorcentaje,
    subtotal,
    iva,
    total: redondear(subtotal + iva),
    stockDisponible,
  };

  if (item.status === "inactive") {
    linea.problema = "inactivo";
    linea.detalle = "Este producto ya no está disponible.";
  } else if (precioUnitario <= 0) {
    // Precio 0 no es "gratis": es un ítem sin precio cargado en la lista.
    linea.problema = "sin_precio";
    linea.detalle = "Este producto no tiene precio publicado. Consultanos.";
  } else if (stockDisponible !== null && stockDisponible <= 0) {
    linea.problema = "sin_stock";
    linea.detalle = "Sin stock por el momento.";
  } else if (stockDisponible !== null && stockDisponible < pedida.qty) {
    linea.problema = "stock_insuficiente";
    linea.detalle = `Quedan ${stockDisponible} unidades disponibles.`;
  }

  return linea;
}

/**
 * Cotiza el carrito contra Alegra en vivo.
 *
 * Nunca tira si un ítem falla: devuelve la línea marcada con `problema` para
 * que el checkout pueda decir QUÉ producto es el que traba el pedido. Un 502
 * genérico deja al cliente sin forma de arreglarlo solo.
 */
export async function cotizar(
  pedidas: LineaPedida[],
  opts: { idPriceList?: string; entregaTipo?: EntregaTipo } = {},
): Promise<Cotizacion> {
  const lineas = await mapConcurrente(pedidas, CONCURRENCIA, async (pedida) => {
    try {
      const item = await getItem(pedida.id);
      if (!item?.id) {
        return lineaRota(pedida, "no_encontrado", "Este producto ya no existe.");
      }
      return cotizarItem(pedida, item, opts.idPriceList);
    } catch (err) {
      console.error(`[cotizacion] ${pedida.id}:`, err);
      return lineaRota(
        pedida,
        "no_encontrado",
        "No pudimos verificar este producto. Probá de nuevo en un momento.",
      );
    }
  });

  const validas = lineas.filter((l) => !l.problema);
  const subtotal = redondear(validas.reduce((a, l) => a + l.subtotal, 0));
  const iva = redondear(validas.reduce((a, l) => a + l.iva, 0));
  const envio = costoEnvio(opts.entregaTipo ?? "retiro");

  return {
    lineas,
    subtotal,
    iva,
    costoEnvio: envio,
    total: redondear(subtotal + iva + envio),
    hayProblemas: lineas.some((l) => l.problema),
  };
}
