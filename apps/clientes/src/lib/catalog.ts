/**
 * Capa de catálogo: adapta el catálogo a la forma `Product` que el shop ya
 * renderiza (ver src/data/products.ts y el ProductCard del DS).
 *
 * De dónde sale cada cosa (ver docs/arquitectura-integraciones.md):
 * - LISTAR y BUSCAR → espejo local en Postgres (`catalog_products`), que
 *   refresca el cron diario `/api/cron/catalog-sync`. Alegra topea en 30 items
 *   por request y el catálogo tiene ~2800: no se puede paginar en vivo.
 * - COMPROMETER un precio o un stock (ficha de producto, checkout) → EN VIVO
 *   contra Alegra. Un número que el shop le promete al cliente nunca sale de
 *   una cache de hasta 24 h.
 *
 * SOLO servidor: usa la DB y el cliente de Alegra. Consumir desde Server
 * Components o API routes, nunca desde el browser.
 *
 * Los campos de marketing (oldPrice, discount, badge) NO vienen de Alegra: son
 * concepto del shop y viven en su propia capa.
 */

import { cache } from "react";
import { and, asc, eq, or, sql } from "drizzle-orm";
import type { ProductStock } from "@myd-org/ui";
import { getDb } from "@/db";
import { catalogCategories, catalogProducts } from "@/db/schema";
import {
  getItem,
  marcaDeCustomFields,
  precioDeLista,
  resolverPrecio,
  type AlegraItem,
  type AlegraPrice,
} from "./alegra";
import type { Product } from "@/data/products";

/** Debajo de esta cantidad, el stock se muestra como "bajo". */
const STOCK_BAJO = 5;

/**
 * Deriva el estado de stock del shop a partir de una cantidad de inventario.
 * - null/undefined (servicio / no inventariable) → siempre disponible.
 * - >= STOCK_BAJO = "in", >0 = "low", 0 = "out".
 */
function derivarStock(qty: number | null | undefined): ProductStock {
  if (qty == null) return "in";
  if (qty <= 0) return "out";
  if (qty < STOCK_BAJO) return "low";
  return "in";
}

// ---------------------------------------------------------------------------
// Lectura desde el espejo local
// ---------------------------------------------------------------------------

/** Fila del join productos × categorías, tal como la devuelve la query. */
interface FilaCatalogo {
  alegraId: string;
  name: string;
  code: string | null;
  description: string | null;
  brand: string | null;
  prices: unknown;
  stock: string | null;
  categoryName: string | null;
}

function mapFilaToProduct(fila: FilaCatalogo, idPriceList?: string): Product {
  const qty = fila.stock != null ? Number(fila.stock) : null;
  return {
    id: fila.alegraId,
    // La marca sale del customField de Alegra; si no está cargado, cae al
    // nombre de la categoría (mismo criterio que la ficha en vivo).
    brand: fila.brand || fila.categoryName || "",
    name: fila.name,
    price: precioDeLista(fila.prices as AlegraPrice[] | undefined, idPriceList),
    stock: derivarStock(qty),
    stockQty: qty ?? undefined,
    sku: fila.code || undefined,
    description: fila.description || undefined,
    category: fila.categoryName || undefined,
    // oldPrice / discount / badge → capa de marketing del shop, no de Alegra.
  };
}

/** Columnas del join, en un solo lugar para no repetirlas entre queries. */
const COLUMNAS_CATALOGO = {
  alegraId: catalogProducts.alegraId,
  name: catalogProducts.name,
  code: catalogProducts.code,
  description: catalogProducts.description,
  brand: catalogProducts.brand,
  prices: catalogProducts.prices,
  stock: catalogProducts.stock,
  categoryName: catalogCategories.name,
};

/**
 * Condición de búsqueda por texto, insensible a mayúsculas Y a tildes.
 *
 * Las tildes importan: el catálogo dice "Termomagnético" y el cliente escribe
 * "termomagnetico". `ILIKE` solo resuelve mayúsculas, así que se normalizan los
 * dos lados con `immutable_unaccent` (ver drizzle/0001_unaccent.sql).
 *
 * Busca en el nombre, en el código y en la descripción — en esta cuenta de
 * Alegra el nombre comercial vive en `description`, así que sin ese tercer
 * campo la búsqueda no encontraría casi nada.
 */
function coincideTexto(q: string) {
  const patron = `%${q}%`;
  const norm = (col: unknown) =>
    sql`immutable_unaccent(lower(${col})) LIKE immutable_unaccent(lower(${patron}))`;
  return or(
    norm(catalogProducts.name),
    norm(catalogProducts.code),
    norm(catalogProducts.description)
  );
}

/**
 * Trae el catálogo desde el espejo local. Solo productos activos.
 *
 * Sin `limit` devuelve el catálogo completo: es una sola query indexada, y las
 * facetas del catálogo solo son correctas si se calculan sobre todo el conjunto.
 * `idPriceList` aplica la lista de precios del cliente logueado si tiene una.
 */
export async function getCatalogo(opts?: {
  idPriceList?: string;
  limit?: number;
  offset?: number;
  busqueda?: string;
}): Promise<Product[]> {
  const q = opts?.busqueda?.trim();

  let query = getDb()
    .select(COLUMNAS_CATALOGO)
    .from(catalogProducts)
    .leftJoin(
      catalogCategories,
      eq(catalogProducts.categoryAlegraId, catalogCategories.alegraId)
    )
    .where(
      and(
        eq(catalogProducts.status, "active"),
        q ? coincideTexto(q) : undefined
      )
    )
    .orderBy(asc(catalogProducts.name))
    .$dynamic();

  if (opts?.limit != null) query = query.limit(opts.limit);
  if (opts?.offset != null) query = query.offset(opts.offset);

  const filas = await query;
  return filas.map((f) => mapFilaToProduct(f, opts?.idPriceList));
}

/**
 * Trae un producto puntual EN VIVO desde Alegra. Es la ficha de producto: el
 * precio y el stock que se muestran acá son los que el shop compromete, así que
 * no salen del espejo. Devuelve null si Alegra no lo encuentra.
 */
export async function getProducto(
  id: string,
  idPriceList?: string
): Promise<Product | null> {
  try {
    const item = await getItem(id);
    return mapItemToProduct(item, idPriceList);
  } catch {
    return null;
  }
}

/** Mapea un item en vivo de Alegra a un `Product` del shop. */
export function mapItemToProduct(
  item: AlegraItem,
  idPriceList?: string
): Product {
  const categoria = item.itemCategory as { name?: string } | undefined;
  return {
    id: item.id,
    name: item.name,
    brand: marcaDeCustomFields(item.customFields) || categoria?.name || "",
    price: resolverPrecio(item, idPriceList),
    stock: derivarStock(item.inventory?.availableQuantity),
    stockQty: item.inventory?.availableQuantity ?? undefined,
    sku: item.reference || undefined,
    description: item.description || undefined,
    category: categoria?.name || undefined,
  };
}

// ---------------------------------------------------------------------------
// Facetas y navegación
// ---------------------------------------------------------------------------

/** Una opcion de filtro con la cantidad real de productos que la cumplen. */
export interface Faceta {
  label: string;
  count: number;
}

export interface Facetas {
  categorias: Faceta[];
  marcas: Faceta[];
}

/** Cuenta ocurrencias de un campo y las ordena de mayor a menor. */
function contar(valores: (string | undefined)[]): Faceta[] {
  const conteo = new Map<string, number>();
  for (const v of valores) {
    if (!v) continue;
    conteo.set(v, (conteo.get(v) ?? 0) + 1);
  }
  return [...conteo.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Facetas de una lista de productos ya cargada. Función pura: los conteos son
 * de esa lista, así que solo son los del catálogo completo si se la llama con
 * el catálogo completo.
 */
export function facetasDe(productos: Product[]): Facetas {
  return {
    categorias: contar(productos.map((p) => p.category)),
    marcas: contar(productos.map((p) => p.brand)),
  };
}

/**
 * Categorías del catálogo, para la navegación (menú del header y grilla del
 * home). Salen del espejo local, filtrando las que no tienen ningún producto
 * activo — una categoría vacía en el menú es un callejón sin salida.
 *
 * Envuelto en `cache` de React para consultarla una sola vez por request.
 */
export const getCategorias = cache(async function getCategorias(): Promise<
  string[]
> {
  const filas = await getDb()
    .selectDistinct({ name: catalogCategories.name })
    .from(catalogCategories)
    .innerJoin(
      catalogProducts,
      and(
        eq(catalogProducts.categoryAlegraId, catalogCategories.alegraId),
        eq(catalogProducts.status, "active")
      )
    )
    .where(eq(catalogCategories.status, "active"))
    .orderBy(asc(catalogCategories.name));

  return filas.map((f) => f.name).filter(Boolean);
});

/** Fecha de la última sync exitosa, para mostrar frescura del catálogo. */
export async function ultimaSincronizacion(): Promise<Date | null> {
  const [fila] = await getDb()
    .select({ max: sql<Date | null>`max(synced_at)` })
    .from(catalogProducts);
  return fila?.max ?? null;
}
