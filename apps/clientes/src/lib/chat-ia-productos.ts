/**
 * Productos para el asistente vendedor del chat (ver platform ADR 0014). Dos
 * formas, porque tienen dos lectores distintos:
 *
 * - `ProductoAgente`: lo que ve el MODELO en el resultado de la tool de
 *   búsqueda. Compacto a propósito: cada campo son tokens en cada vuelta del
 *   loop, y el modelo sólo necesita elegir y explicar. El `id` es el que después
 *   manda en las cards; ai-api acepta sólo ids que aparecieron acá.
 * - `ProductoResuelto`: lo que dibuja el WIDGET en una card (`resolveProducts`).
 *   Lleva el precio de la lista de quien mira: el modelo nunca pone un precio.
 *
 * Funciones puras: las rutas hacen la lectura de la base.
 */
import type { Product } from "@/data/products";
import { atributosDeProducto } from "./catalogo-atributos";
import { atributosParaAgente, etiquetasTecnicas } from "./catalogo-caracteristicas";
import { maxCantidad } from "./catalogo-vista";
import { formatMarca, formatRubro } from "./formato-rubro";

/** Largo de la descripción que ve el modelo. Más es ruido y costo. */
export const DESCRIPCION_MAX = 200;
/** Resultados por búsqueda del agente: mira los primeros, no pagina. */
export const LIMITE_BUSQUEDA_DEFAULT = 8;
export const LIMITE_BUSQUEDA_MAX = 10;
/** Ids por pedido de `resolveProducts`: una card de carrito tiene hasta 60 líneas. */
export const MAX_IDS_RESOLVER = 60;

export interface ProductoAgente {
  id: string;
  nombre: string;
  marca?: string;
  categoria?: string;
  /** Precio final de la lista general, sólo para comparar opciones. No se cita. */
  precioReferencia: number;
  stock: "disponible" | "pocas unidades" | "sin stock";
  descripcion?: string;
  /**
   * Datos técnicos estructurados del CRM (fichas estructuradas, fase 2), compactos:
   * `{ potencia_w: 50, tono: "calido", tension_v: "85-265", zocalo: "e27" }`. Así el agente
   * compara sin leer PDFs. Ausente si el producto no tiene o la tabla no está disponible.
   */
  atributos?: Record<string, number | string>;
}

/** Contrato `ResolvedProduct` de platform/contracts/sales-cards/v1. */
export interface ProductoResuelto {
  id: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  price?: number;
  available: boolean;
  /** Código del producto (línea "Cód." de la card); ausente si el nombre ya es el código. */
  sku?: string;
  /** Unidades que deja elegir el contador de la card: las disponibles, o el tope general. */
  maxQuantity: number;
  /** Unidades, sólo con stock bajo ("Queda 1" / "Quedan N"), igual que la card del catálogo. */
  stock?: number;
  /** Código del producto (card `spec`, ai-widget 0.7.0), siempre que se conozca. */
  code?: string;
  /**
   * Nombres de los atributos del diccionario que cumple el producto (card
   * `spec`): "Luz cálida", "Apto exterior"… Mismo criterio que el filtro `atr`.
   */
  attributes?: string[];
  /** Ficha técnica (PDF), si el producto tiene una cargada en el CRM. */
  specUrl?: string;
  /**
   * Propio del Shop (el widget lo ignora): precio NETO, el que guarda el
   * carrito (`CartItem.price`). `price` es el exhibido, con IVA si se conoce.
   */
  precioNeto: number;
}

const STOCK_TEXTO: Record<string, ProductoAgente["stock"]> = {
  in: "disponible",
  low: "pocas unidades",
  out: "sin stock",
};

function recortar(texto: string | undefined, max: number): string | undefined {
  const t = texto?.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function aProductoAgente(p: Product): ProductoAgente {
  return {
    id: p.id,
    nombre: p.name,
    ...(p.brand ? { marca: p.brand } : {}),
    ...(p.category ? { categoria: p.category } : {}),
    precioReferencia: p.precioFinal ?? p.price,
    stock: STOCK_TEXTO[p.stock] ?? "disponible",
    ...(recortar(p.description, DESCRIPCION_MAX) ? { descripcion: recortar(p.description, DESCRIPCION_MAX) } : {}),
    ...(atributosParaAgente(p.atributosEstructurados) ? { atributos: atributosParaAgente(p.atributosEstructurados) } : {}),
  };
}

export function aProductoResuelto(p: Product): ProductoResuelto {
  const precio = p.precioFinal ?? p.price;
  return {
    id: p.id,
    name: p.name,
    ...(p.brand ? { brand: p.brand } : {}),
    ...(p.images?.[0]?.url ? { imageUrl: p.images[0].url } : {}),
    // Un producto a $ 0 no se puede agregar al carrito (CartContext lo descarta):
    // sin precio la card muestra el nombre y no un "$ 0" engañoso.
    ...(precio > 0 ? { price: precio } : {}),
    available: p.stock !== "out" && precio > 0,
    ...(p.sku && p.sku !== p.name ? { sku: p.sku } : {}),
    maxQuantity: maxCantidad(p),
    ...(p.stock === "low" && p.stockQty != null && p.stockQty > 0 ? { stock: p.stockQty } : {}),
    ...(p.sku ? { code: p.sku } : {}),
    ...atributosDe(p),
    ...(p.fichaTecnicaUrl ? { specUrl: p.fichaTecnicaUrl } : {}),
    precioNeto: p.price,
  };
}

/**
 * `{ attributes }` para la card `spec`: los atributos del diccionario que cumple el producto (dato
 * estructurado primero, patrón del nombre si no hay) y, con datos estructurados, los valores
 * técnicos ("50 W", "3000 K", "IP65"). El contrato `sales-cards/v1` es una lista de textos.
 */
function atributosDe(p: Pick<Product, "name" | "description" | "atributosEstructurados">): { attributes?: string[] } {
  // Sin repetidos: "220 V" puede salir del diccionario y del valor técnico a la vez.
  const nombres = [
    ...new Set([
      ...atributosDeProducto(`${p.name} ${p.description ?? ""}`, p.atributosEstructurados).map((a) => a.nombre),
      ...etiquetasTecnicas(p.atributosEstructurados),
    ]),
  ];
  return nombres.length ? { attributes: nombres } : {};
}

/** Una opción de faceta para el agente: `id` es lo que viaja en la URL del catálogo. */
export interface OpcionFaceta {
  id: string;
  nombre: string;
}

/** Facetas del conjunto que encontró la búsqueda del agente (`/api/chat-ia/buscar?facetas=1`). */
export interface FacetasAgente {
  categorias: OpcionFaceta[];
  marcas: OpcionFaceta[];
  atributos: OpcionFaceta[];
}

/**
 * Facetas de los productos encontrados, con los mismos ids que filtra el
 * catálogo (así `navigate_catalog` sólo propone filtros que existen):
 * - categorías por NOMBRE: la categoría propia del producto si el tenant
 *   tiene árbol (`nombresCategoriaPropia`: id → nombre), si no la de Alegra;
 * - marcas por la marca exhibida (la que usa `?marca=`);
 * - atributos del diccionario que cumple el nombre o la descripción.
 * Sin repetidos, en el orden en que aparecen (el de relevancia).
 */
export function facetasDeProductos(
  productos: readonly Product[],
  nombresCategoriaPropia: ReadonlyMap<string, string>,
): FacetasAgente {
  const conArbol = nombresCategoriaPropia.size > 0;
  const categorias = new Map<string, OpcionFaceta>();
  const marcas = new Map<string, OpcionFaceta>();
  const atributos = new Map<string, OpcionFaceta>();
  for (const p of productos) {
    const categoria = conArbol
      ? p.categoriaPropiaId && nombresCategoriaPropia.get(p.categoriaPropiaId)
      : p.category;
    if (categoria && !categorias.has(categoria)) categorias.set(categoria, { id: categoria, nombre: formatRubro(categoria) });
    if (p.brand && !marcas.has(p.brand)) marcas.set(p.brand, { id: p.brand, nombre: formatMarca(p.brand) });
    for (const a of atributosDeProducto(`${p.name} ${p.description ?? ""}`, p.atributosEstructurados)) {
      if (!atributos.has(a.id)) atributos.set(a.id, { id: a.id, nombre: a.nombre });
    }
  }
  return { categorias: [...categorias.values()], marcas: [...marcas.values()], atributos: [...atributos.values()] };
}

/** `limit` del query acotado a [1, LIMITE_BUSQUEDA_MAX]; basura ⇒ el default. */
export function limiteBusqueda(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return LIMITE_BUSQUEDA_DEFAULT;
  return Math.min(n, LIMITE_BUSQUEDA_MAX);
}

/**
 * Líneas de una card del chat → altas para `addItems` del carrito. Sólo entra
 * lo que la tienda resolvió como disponible: un id que ya no se vende (o que el
 * servidor no devolvió) no llega al carrito aunque el agente lo haya propuesto.
 * `price` es el NETO, como en el resto del carrito.
 */
export function lineasAItems(
  lineas: readonly { id: string; qty: number }[],
  resueltos: ReadonlyMap<string, ProductoResuelto>,
): { item: { id: string; name: string; brand: string; price: number; image?: string }; qty: number }[] {
  return lineas.flatMap(({ id, qty }) => {
    const p = resueltos.get(id);
    if (!p?.available || !(p.precioNeto > 0)) return [];
    return [{ item: { id, name: p.name, brand: p.brand ?? "", price: p.precioNeto, ...(p.imageUrl ? { image: p.imageUrl } : {}) }, qty }];
  });
}
