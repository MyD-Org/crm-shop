/**
 * Capa de catálogo: adapta los items de Alegra a la forma `Product` que el
 * shop ya renderiza (ver src/data/products.ts y el ProductCard del DS).
 *
 * SOLO servidor: usa el cliente de Alegra. Consumir desde Server Components o
 * API routes, nunca desde el browser.
 *
 * Los campos de marketing (oldPrice, discount, badge) NO vienen de Alegra: son
 * concepto del shop y viven en su propia capa (ver docs/arquitectura-integraciones.md).
 */

import type { ProductStock } from "@myd-org/ui";
import { getItems, resolverPrecio, type AlegraItem } from "./alegra";
import type { Product } from "@/data/products";

/** Debajo de esta cantidad, el stock se muestra como "bajo". */
const STOCK_BAJO = 5;

/**
 * Deriva el estado de stock del shop a partir del inventario de Alegra.
 * - Item sin inventario (servicio / no inventariable) → siempre disponible.
 * - Con inventario: >= STOCK_BAJO = "in", >0 = "low", 0 = "out".
 */
function derivarStock(item: AlegraItem): ProductStock {
  const qty = item.inventory?.availableQuantity;
  if (qty == null) return "in";
  if (qty <= 0) return "out";
  if (qty < STOCK_BAJO) return "low";
  return "in";
}

/**
 * Extrae la marca. Alegra no tiene un campo "marca" nativo, así que se busca
 * en customFields (por nombre) y se cae a la categoría del item.
 * TODO: confirmar contra la cuenta real dónde cargan la marca (customField vs
 * itemCategory) y ajustar acá.
 */
function extraerMarca(item: AlegraItem): string {
  const custom = item.customFields as
    | Array<{ name?: string; value?: unknown }>
    | undefined;
  const campoMarca = custom?.find((c) =>
    /marca|brand/i.test(c.name ?? "")
  );
  if (campoMarca?.value) return String(campoMarca.value);

  const categoria = item.itemCategory as { name?: string } | undefined;
  return categoria?.name ?? "";
}

/**
 * Mapea un item de Alegra a un `Product` del shop.
 * @param idPriceList  lista de precios del cliente logueado (si tiene una).
 */
export function mapItemToProduct(
  item: AlegraItem,
  idPriceList?: string
): Product {
  return {
    id: item.id,
    name: item.name,
    brand: extraerMarca(item),
    price: resolverPrecio(item, idPriceList),
    stock: derivarStock(item),
    // oldPrice / discount / badge → capa de marketing del shop, no de Alegra.
  };
}

/**
 * Trae el catálogo desde Alegra y lo mapea a `Product[]`.
 * Solo items activos. `idPriceList` aplica la lista del cliente si corresponde.
 */
export async function getCatalogo(opts?: {
  idPriceList?: string;
  limit?: number;
  start?: number;
  busqueda?: string;
}): Promise<Product[]> {
  const items = await getItems({
    status: "active",
    limit: opts?.limit,
    start: opts?.start,
    name: opts?.busqueda,
  });
  return items.map((item) => mapItemToProduct(item, opts?.idPriceList));
}
