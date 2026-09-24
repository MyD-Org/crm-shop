/**
 * Cotización del carrito. El único lugar donde se calcula un total.
 *
 * REGLA CENTRAL: el precio, el IVA y el stock los resuelve el SERVIDOR. El
 * navegador manda `{ id, qty }` y nada más: si el precio viaja desde el
 * cliente, el precio se edita desde el cliente.
 *
 * Fuente: el espejo del catálogo (`catalog_products`), con stock, precios y
 * estado de la fuente más fresca entre ese espejo y la vista del CRM, y el stock
 * menos lo reservado por los pedidos vivos del Shop (ver `stock-disponible.ts`). Los precios que valen son los que publica la tienda: el carrito, el checkout y el pedido usan el
 * mismo número, en una sola consulta y sin llamadas a Alegra (decisión
 * 2026-09-23). Antes era una llamada a Alegra por línea en cada cambio de
 * cantidad: lento, y un riesgo para el rate limit de la cuenta.
 *
 * SOLO servidor: usa la DB.
 */

import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { catalogCategories, catalogProducts, stockReservado } from "@/db/schema";
import { crmOverlay, crmStock } from "@/db/crm";
import {
  esIdAlegra,
  ivaDeItem,
  mapPrecios,
  marcaDeCustomFields,
  resolverPrecio,
  type AlegraItem,
} from "./alegra";
import { estadoSql, joinReserva, joinStockCrm, preciosSql, stockSql } from "./stock-disponible";
import { joinOverlay, nombreExhibidoSql } from "./nombre-exhibido";
import { costoEnvio, type EntregaTipo } from "./envio";
import { MAX_LINEAS, QTY_MAX } from "./carrito-cliente";

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

// Máximo de unidades por línea y techo de líneas por pedido: los mismos del
// carrito, definidos en el módulo puro (este importa la base). MAX_LINEAS se
// re-exporta porque lo importan las rutas de pedidos y de cotizar.
export { MAX_LINEAS };

const redondear = (n: number) => Math.round(n * 100) / 100;


/**
 * Normaliza y deduplica lo que llegó del browser. Se hace ANTES de consultar
 * para no gastar consultas en basura, y porque dos líneas del mismo id
 * romperían la validación de stock (cada una pasaría por separado).
 */
export function normalizarLineas(raw: unknown): LineaPedida[] {
  if (!Array.isArray(raw)) return [];
  const porId = new Map<string, number>();

  for (const item of raw) {
    const id = String((item as LineaPedida)?.id ?? "").trim();
    const qty = Math.floor(Number((item as LineaPedida)?.qty));
    // Solo ids numéricos: el id termina en una ruta de Alegra (ver esIdAlegra).
    if (!esIdAlegra(id) || !Number.isFinite(qty) || qty <= 0) continue;
    porId.set(id, Math.min((porId.get(id) ?? 0) + qty, QTY_MAX));
  }

  return [...porId.entries()]
    .slice(0, MAX_LINEAS)
    .map(([id, qty]) => ({ id, qty }));
}

/** Corre `fn` sobre `items` con paralelismo acotado, preservando el orden. */
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

export function cotizarItem(
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

/** Columnas del espejo que hacen falta para cotizar una línea. */
export interface FilaEspejo {
  alegraId: string;
  name: string;
  code: string | null;
  brand: string | null;
  prices: unknown;
  stock: string | null;
  ivaPorcentaje: string | null;
  status: string;
  categoryName: string | null;
}

/**
 * Fila del espejo con la forma de un ítem de Alegra, que es lo que calcula
 * `cotizarItem`.
 *
 * - IVA null en el espejo → sin `tax`, y `ivaDeItem` cae a `IVA_DEFAULT`.
 * - Stock null → ítem no inventariable (siempre disponible).
 * - Precios: pasan por `mapPrecios` porque pueden venir crudos del CRM (ids
 *   numéricos); sobre los del espejo del Shop no cambia nada.
 */
export function itemDesdeEspejo(fila: FilaEspejo): AlegraItem {
  return {
    id: fila.alegraId,
    name: fila.name,
    reference: fila.code ?? undefined,
    status: fila.status === "active" ? "active" : "inactive",
    price: mapPrecios(fila.prices),
    tax:
      fila.ivaPorcentaje != null
        ? [{ percentage: Number(fila.ivaPorcentaje) }]
        : undefined,
    inventory:
      fila.stock != null ? { availableQuantity: Number(fila.stock) } : undefined,
    customFields: fila.brand ? [{ name: "Marca", value: fila.brand }] : undefined,
    itemCategory: fila.categoryName ? { name: fila.categoryName } : undefined,
  };
}

/**
 * Una consulta para todas las líneas. Si la base falla, tira: no hay total.
 *
 * Stock, precios y estado salen de la misma elección por fila (CRM o Shop) que
 * usan el catálogo y la ficha, con la reserva ya descontada: lo que el
 * visitante vio es lo que se cotiza, y `POST /api/pedidos` valida y calcula con
 * esta misma cotización (y revalida el disponible dentro de la transacción del
 * pedido, ver `crearPedido`).
 */
async function leerEspejo(ids: string[]): Promise<Map<string, AlegraItem>> {
  if (ids.length === 0) return new Map();
  const filas: FilaEspejo[] = await getDb()
    .select({
      alegraId: catalogProducts.alegraId,
      // El mismo nombre que el catálogo y el carrito (ver nombre-exhibido.ts).
      name: nombreExhibidoSql,
      code: catalogProducts.code,
      brand: catalogProducts.brand,
      prices: preciosSql,
      stock: stockSql,
      ivaPorcentaje: catalogProducts.ivaPorcentaje,
      status: estadoSql,
      categoryName: catalogCategories.name,
    })
    .from(catalogProducts)
    .leftJoin(
      catalogCategories,
      eq(catalogProducts.categoryAlegraId, catalogCategories.alegraId),
    )
    .leftJoin(crmStock, joinStockCrm())
    .leftJoin(stockReservado, joinReserva())
    .leftJoin(crmOverlay, joinOverlay())
    .where(inArray(catalogProducts.alegraId, ids));
  return new Map(filas.map((f) => [f.alegraId, itemDesdeEspejo(f)]));
}

/**
 * Cotiza el carrito con los precios, el IVA y el stock del espejo.
 *
 * Nunca tira si un ítem falla: devuelve la línea marcada con `problema` para
 * que el checkout pueda decir QUÉ producto es el que traba el pedido. Si falla
 * la base sí tira: sin datos no hay total.
 */
export async function cotizar(
  pedidas: LineaPedida[],
  opts: { idPriceList?: string; entregaTipo?: EntregaTipo } = {},
): Promise<Cotizacion> {
  const items = await leerEspejo(pedidas.map((p) => p.id));
  const lineas = pedidas.map((pedida) => {
    const item = items.get(pedida.id);
    return item
      ? cotizarItem(pedida, item, opts.idPriceList)
      : lineaRota(pedida, "no_encontrado", "Este producto ya no existe.");
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
