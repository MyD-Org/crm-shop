/**
 * Capa de catálogo: adapta el catálogo a la forma `Product` que el shop ya
 * renderiza (ver src/data/products.ts y el ProductCard del DS).
 *
 * De dónde sale cada cosa (ver docs/arquitectura-integraciones.md):
 * - TODO el producto (nombre, descripción, código, marca, categoría de Alegra,
 *   IVA, precios, stock y estado) → las vistas del CRM
 *   `public.catalog_products_shop` (`crmCatalogo`) y
 *   `public.catalog_categories_shop` (`crmCategoriasAlegra`). Las mantienen la
 *   sync diaria del CRM y los webhooks de Alegra. El Shop no tiene copia propia
 *   ni sync del catálogo. Alegra topea en 30 items por request y el catálogo
 *   tiene miles: no se puede paginar en vivo.
 * - Las vistas son de TODOS los tenants: toda consulta tiene de base
 *   `crmCatalogo` con `enTenantCatalogo()` en el WHERE, y el join a las
 *   categorías de Alegra lleva el tenant en el ON (ver catalogo-fuente.ts y la
 *   guarda catalogo-tenant.test.ts).
 * - Ficha, carrito, checkout y pedido → la misma vista: valen los precios que
 *   publica la tienda (ver src/lib/cotizacion.ts).
 * - Curaduría (nombre, fotos, visibilidad, categoría propia) → overlay y árbol
 *   del CRM (`catalog_overlay`, `shop_categories`).
 * - El stock es el DISPONIBLE: se le resta lo reservado por pedidos vivos del
 *   Shop (ver src/lib/stock-disponible.ts). Toda consulta joinea
 *   `stockReservado` para eso.
 *
 * SOLO servidor: usa la DB y el cliente de Alegra. Consumir desde Server
 * Components o API routes, nunca desde el browser.
 *
 * Los campos de marketing (oldPrice, discount, badge) NO vienen de Alegra: son
 * concepto del shop y viven en su propia capa.
 */

import { cache } from "react";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { ProductStock } from "@myd-org/ui";
import { getDb } from "@/db";
import { stockReservado } from "@/db/schema";
import { crmCatalogo, crmCategorias, crmCategoriasAlegra, crmOverlay, type FotoCrm } from "@/db/crm";
import { esIdAlegra, mapPrecios, precioDeLista } from "./alegra";
import { activoSql, joinReserva, preciosSql, stockSql } from "./stock-disponible";
import { enTenantCatalogo, joinCategoriasAlegra } from "./catalogo-fuente";
import { ORDEN_DEFAULT, type OrdenCatalogo, type RangoPrecio } from "./catalogo-url";
import { fotosPermitidas, hostsDeMedios } from "./catalogo-medios";
import { basePublicaMedios } from "./shop-media";
import { shopTenantId } from "./tenant";
import { precioFinal } from "./precio-final";
import { joinOverlay, nombreExhibido } from "./nombre-exhibido";
import type { Product } from "@/data/products";

/** Debajo de esta cantidad, el stock se muestra como "bajo". */
const STOCK_BAJO = 5;

/**
 * Deriva el estado de stock del shop a partir de una cantidad de inventario.
 * - null/undefined (servicio / no inventariable) → siempre disponible.
 * - >= STOCK_BAJO = "in", >0 = "low", 0 = "out".
 */
export function derivarStock(qty: number | null | undefined): ProductStock {
  if (qty == null) return "in";
  if (qty <= 0) return "out";
  if (qty < STOCK_BAJO) return "low";
  return "in";
}

// ---------------------------------------------------------------------------
// Lectura desde el catálogo del CRM
// ---------------------------------------------------------------------------

/** Fila del join productos × categorías × overlay, tal como la devuelve la query. */
interface FilaCatalogo {
  alegraId: string;
  name: string;
  code: string | null;
  description: string | null;
  brand: string | null;
  /** Crudos de Alegra (vista del CRM): se normalizan con `mapPrecios`. */
  prices: unknown;
  stock: string | null;
  /** numeric de Postgres: llega como string. null = sin IVA conocido. */
  ivaPorcentaje: string | null;
  categoryName: string | null;
  /** Nombre curado en el CRM. null = sin fila de overlay o sin nombre. */
  overlayNombre: string | null;
  /** Fotos del overlay, con la key de R2. null = sin fila de overlay (left join). */
  overlayFotos: FotoCrm[] | null;
}

/**
 * Campos de precio con impuestos, mismos para espejo y ficha en vivo. Sin IVA
 * conocido quedan undefined y la exhibición muestra el precio como antes.
 */
function camposIva(
  precioNeto: number,
  iva: number | null,
): Pick<Product, "ivaPorcentaje" | "precioFinal"> {
  if (iva == null || !Number.isFinite(iva)) return {};
  return { ivaPorcentaje: iva, precioFinal: precioFinal(precioNeto, iva) };
}

export function mapFilaToProduct(
  fila: FilaCatalogo,
  idPriceList?: string,
  /** Ver `hostsDeMedios()`. Parámetro para testear sin tocar `process.env`. */
  hostsMedios: readonly string[] = hostsDeMedios(),
  /** Ver `basePublicaMedios()`. Parámetro para testear sin tocar `process.env`. */
  baseMedios: string | null = basePublicaMedios(),
): Product {
  const qty = fila.stock != null ? Number(fila.stock) : null;
  const price = precioDeLista(mapPrecios(fila.prices), idPriceList);
  return {
    id: fila.alegraId,
    // La marca sale del customField de Alegra; si no está cargado, cae al
    // nombre de la categoría (mismo criterio que la ficha en vivo).
    brand: fila.brand || fila.categoryName || "",
    name: nombreExhibido(fila),
    price,
    ...camposIva(price, fila.ivaPorcentaje != null ? Number(fila.ivaPorcentaje) : null),
    stock: derivarStock(qty),
    stockQty: qty ?? undefined,
    // `reference` de Alegra; si falta, `name`, que en esta cuenta ES el
    // código (y es con lo que el CRM elige destacados, ver destacados.ts).
    sku: fila.code || fila.name || undefined,
    description: fila.description || undefined,
    category: fila.categoryName || undefined,
    images: fotosPermitidas(urlsDeFotos(fila.overlayFotos, baseMedios), hostsMedios),
    // oldPrice / discount / badge → capa de marketing del shop, no de Alegra.
  };
}

/**
 * El CRM guarda la key del objeto en R2 y la URL se compone al leer, con la
 * misma base pública que usa el CRM. Sin base configurada no hay fotos.
 */
function urlsDeFotos(fotos: FotoCrm[] | null, base: string | null) {
  if (!fotos?.length || !base) return undefined;
  return fotos.map((f) => ({ url: `${base}/${f.key}`, w: f.w, ...(f.alt !== undefined ? { alt: f.alt } : {}) }));
}


/**
 * Sólo productos publicados en el CRM, detrás del flag
 * `catalogo-solo-visibles` (Vercel Flags, apagado por defecto). Fail-closed:
 * sin fila de overlay el left join deja `visible` en NULL y el producto queda
 * afuera, así que con el flag prendido y sin curaduría la tienda queda vacía.
 *
 * El valor del flag lo pasa quien llama (`flagsPublicos()`, por request): esta
 * capa no evalúa flags, así se puede leer desde un scope cacheado y el valor
 * queda en la clave de la caché (ver src/lib/catalogo-publico.ts).
 */
function soloVisiblesSql(soloVisibles: boolean) {
  return soloVisibles ? eq(crmOverlay.visible, true) : undefined;
}

/**
 * Columnas del join, en un solo lugar para no repetirlas entre queries. El
 * stock, menos lo reservado (exige el join a `stockReservado`).
 */
const COLUMNAS_CATALOGO = {
  alegraId: crmCatalogo.alegraId,
  name: crmCatalogo.name,
  code: crmCatalogo.code,
  description: crmCatalogo.description,
  brand: crmCatalogo.brand,
  prices: preciosSql,
  stock: stockSql,
  ivaPorcentaje: crmCatalogo.ivaPorcentaje,
  categoryName: crmCategoriasAlegra.name,
  overlayNombre: crmOverlay.nombre,
  overlayFotos: crmOverlay.fotos,
};

/**
 * Condición de búsqueda por texto, insensible a mayúsculas Y a tildes.
 *
 * Las tildes importan: el catálogo dice "Termomagnético" y el cliente escribe
 * "termomagnetico". `ILIKE` solo resuelve mayúsculas, así que se normalizan los
 * dos lados con `"shop".immutable_unaccent` (ver drizzle/0000_baseline.sql).
 *
 * La función se llama CALIFICADA con su esquema: vive en `shop`, y que se
 * resuelva sin calificar dependería del `search_path` de la conexión, que por
 * el pooler no está garantizado. Es el único objeto SQL que este código nombra
 * a mano; las vistas del CRM las califica drizzle desde `crm.ts`, y las
 * columnas quedan calificadas con el nombre de la vista.
 *
 * Busca en el nombre, en el código y en la descripción — en esta cuenta de
 * Alegra el nombre comercial vive en `description`, así que sin ese tercer
 * campo la búsqueda no encontraría casi nada.
 */
function coincideTexto(q: string) {
  const patron = `%${q}%`;
  const norm = (col: unknown) =>
    sql`"shop".immutable_unaccent(lower(${col})) LIKE "shop".immutable_unaccent(lower(${patron}))`;
  return or(
    norm(crmCatalogo.name),
    norm(crmCatalogo.code),
    norm(crmCatalogo.description)
  );
}

/**
 * Trae el catálogo del tenant desde la vista del CRM. Solo productos activos.
 *
 * Sin `limit` devuelve el catálogo completo: es una sola query indexada, y las
 * facetas del catálogo solo son correctas si se calculan sobre todo el conjunto.
 * `idPriceList` aplica la lista de precios del cliente logueado si tiene una.
 */
export async function getCatalogo(opts: {
  /** Flag `catalogo-solo-visibles` (ver `soloVisiblesSql`). */
  soloVisibles: boolean;
  idPriceList?: string;
  limit?: number;
  offset?: number;
  busqueda?: string;
}): Promise<Product[]> {
  const q = opts.busqueda?.trim();

  let query = getDb()
    .select(COLUMNAS_CATALOGO)
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay())
    .leftJoin(stockReservado, joinReserva())
    .where(
      and(
        enTenantCatalogo(),
        activoSql,
        conPrecioSql,
        soloVisiblesSql(opts.soloVisibles),
        q ? coincideTexto(q) : undefined
      )
    )
    .orderBy(asc(crmCatalogo.name))
    .$dynamic();

  if (opts.limit != null) query = query.limit(opts.limit);
  if (opts.offset != null) query = query.offset(opts.offset);

  const filas = await query;
  return filas.map((f) => mapFilaToProduct(f, opts.idPriceList));
}

/**
 * Productos del catálogo por id de Alegra, para las líneas de pedido de Mi
 * cuenta (y favoritos). Una sola consulta por llamada: quien tiene N líneas
 * junta los ids y llama una vez, nunca una por línea.
 *
 * Sin filtro de estado por default: un pedido viejo sigue mostrando el nombre
 * real de un ítem que después se despublicó. `soloActivos` aplica
 * `activo` y, con `soloVisibles` (el flag `catalogo-solo-visibles`), también
 * `visible` (mismo criterio que la lista pública). `soloVisibles` sin
 * `soloActivos` no filtra nada.
 *
 * Sin `orderBy` (el orden lo decide quien llama: pedidos por línea, favoritos
 * por fecha) y sin `limit` (los ids ya vienen acotados por quien llama). Un id
 * que la vista no tiene (para este tenant) simplemente no aparece en el `Map`.
 */
export async function getProductosPorIds(
  alegraIds: readonly string[],
  opts?: { idPriceList?: string; soloActivos?: boolean; soloVisibles?: boolean },
): Promise<Map<string, Product>> {
  if (alegraIds.length === 0) return new Map();

  const filas = await getDb()
    .select(COLUMNAS_CATALOGO)
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay())
    .leftJoin(stockReservado, joinReserva())
    .where(
      and(
        enTenantCatalogo(),
        inArray(crmCatalogo.alegraId, [...alegraIds]),
        opts?.soloActivos ? activoSql : undefined,
        opts?.soloActivos ? soloVisiblesSql(opts.soloVisibles ?? false) : undefined,
      ),
    );

  return new Map(
    filas.map((f) => [f.alegraId, mapFilaToProduct(f, opts?.idPriceList)]),
  );
}

// ---------------------------------------------------------------------------
// Catálogo paginado (filtros, orden y conteo en el servidor)
// ---------------------------------------------------------------------------

/** Cuántos productos entran en una página del catálogo. Múltiplo de la grilla (1/2/3 columnas). */
export const PRODUCTOS_POR_PAGINA = 24;

/** Filtros que aplica el servidor. Categorías y marcas son OR dentro del grupo. */
export interface FiltrosCatalogo {
  busqueda?: string;
  categorias?: string[];
  marcas?: string[];
  /** Extremos inclusivos del rango, sobre el precio exhibido (con IVA). */
  precioMin?: number;
  precioMax?: number;
  /** Sólo productos con disponibilidad (ver `condicionesDe`). */
  soloStock?: boolean;
}

export interface PaginaCatalogo {
  productos: Product[];
  /** Total de productos que cumplen los filtros (no los de esta página). */
  total: number;
  /** Página efectiva, 1-based y ya acotada al rango válido. */
  pagina: number;
  /** Cantidad de páginas. 0 productos ⇒ 1 página (la vacía). */
  paginas: number;
}

/**
 * Marca efectiva del producto, en SQL. Tiene que replicar el fallback de
 * `mapFilaToProduct`: si el customField de Alegra vino vacío, la marca que se
 * exhibe (y por la que se filtra) es el nombre de la categoría.
 */
const marcaSql = sql<string>`coalesce(nullif(${crmCatalogo.brand}, ''), ${crmCategoriasAlegra.name})`;

/**
 * Precio de lista principal, extraído del jsonb `prices`. Equivalente en SQL de
 * `precioDeLista` sin lista de cliente: el que tiene `main`, si no el primero.
 * El guard de `jsonb_typeof` evita que `jsonb_array_elements` explote si algún
 * ítem quedó con precios que no son un array. Son los precios crudos de
 * Alegra (`precios_alegra` de la vista): `price` y `main` tal cual.
 */
const precioSql = sql<string>`coalesce(
  case when jsonb_typeof(${preciosSql}) = 'array' then (
    select (elem->>'price')::numeric
    from jsonb_array_elements(${preciosSql}) elem
    where (elem->>'main')::boolean
    limit 1
  ) end,
  case when jsonb_typeof(${preciosSql}) = 'array'
    then (${preciosSql}->0->>'price')::numeric end,
  0
)`;

/**
 * Precio que ve el visitante, en SQL: el final con IVA cuando se conoce la
 * alícuota, si no el neto — mismo criterio que `precioExhibido` del cliente.
 * No replica el redondeo al centavo de `precioFinal()`: acá se usa para
 * ORDENAR, para el rango de precio del slider y para el filtro por rango, que
 * viaja en enteros (`precio_min`/`precio_max`), así que el borde `>=`/`<=`
 * sobre el valor sin redondear es indistinguible para el visitante. El número
 * que se muestra sigue saliendo de `mapFilaToProduct`.
 */
const precioExhibidoSql = sql<string>`${precioSql} * (1 + coalesce(${crmCatalogo.ivaPorcentaje}, 0) / 100)`;

/**
 * Sólo productos con precio. Un ítem sin precio en Alegra resuelve a 0 en
 * `precioSql`; listarlo lo mostraría a "$ 0" con botón de comprar y la venta
 * saldría a precio cero. El control de fondo es la visibilidad del overlay del
 * CRM; esto es la red de seguridad del Shop para todo listado público.
 */
const conPrecioSql = sql`${precioSql} > 0`;

/**
 * "Solo con stock", en SQL. Replica `derivarStock`: null = no inventariable
 * = disponible; `<= 0` = sin stock.
 */
const conStockSql = sql`(${stockSql} is null or ${stockSql} > 0)`;

/**
 * ¿El tenant ya armó su árbol de categorías en el CRM? Mientras no tenga
 * ninguna, todo sigue con las de Alegra.
 */
const hayArbolSql = () =>
  sql`exists (select 1 from ${crmCategorias} where activa and tenant_id = ${shopTenantId()})`;

/**
 * Filtro por categorías, por NOMBRE (es lo que viaja en `?categoria=`).
 *
 * Con árbol propio, una categoría incluye todo su subárbol: tildar
 * "ILUMINACION" trae también lo clasificado en "Focos led". El producto se
 * ubica por la categoría que le asignaron en el CRM (`catalog_overlay`); sin
 * clasificar no cae en ninguna. Sin árbol, el filtro de siempre sobre la
 * categoría de Alegra.
 */
function filtroCategoriasSql(nombres: string[]) {
  const lista = sql.join(
    nombres.map((n) => sql`${n}`),
    sql`, `,
  );
  const tenant = shopTenantId();
  const subarbol = sql`(
    with recursive arbol as (
      select id from ${crmCategorias} where activa and tenant_id = ${tenant} and nombre in (${lista})
      union all
      select c.id from ${crmCategorias} c join arbol a on c.parent_id = a.id where c.activa
    )
    select id from arbol
  )`;
  return sql`((${hayArbolSql()} and ${crmOverlay.categoriaId} in ${subarbol})
    or (not ${hayArbolSql()} and ${inArray(crmCategoriasAlegra.name, nombres)}))`;
}

/** Categoría propia activa, tal como la necesitan el menú y las facetas. */
interface NodoCategoria {
  id: string;
  parentId: string | null;
  nombre: string;
  orden: number;
}

/** Árbol de categorías propias activas del tenant. Vacío = todavía no armó ninguna. */
const getArbolCategorias = cache(async function getArbolCategorias(): Promise<NodoCategoria[]> {
  return getDb()
    .select({
      id: crmCategorias.id,
      parentId: crmCategorias.parentId,
      nombre: crmCategorias.nombre,
      orden: crmCategorias.orden,
    })
    .from(crmCategorias)
    .where(and(eq(crmCategorias.tenantId, shopTenantId()), eq(crmCategorias.activa, true)));
});

/**
 * Suma los conteos por categoría hacia arriba (cada producto cuenta en su
 * categoría y en todas las que la contienen) y devuelve el árbol en orden de
 * lectura —una rama entera antes de la siguiente—, sin las ramas vacías.
 * Una categoría inactiva corta su rama: lo que cuelga de ella no se muestra.
 */
export function enArbolConConteo(
  arbol: NodoCategoria[],
  conteos: Map<string, number>,
): (Faceta & { nivel: number })[] {
  const porId = new Map(arbol.map((n) => [n.id, n]));
  const total = new Map<string, number>();
  for (const [id, cantidad] of conteos) {
    const vistos = new Set<string>();
    for (let n = porId.get(id); n && !vistos.has(n.id); n = n.parentId ? porId.get(n.parentId) : undefined) {
      vistos.add(n.id);
      total.set(n.id, (total.get(n.id) ?? 0) + cantidad);
    }
  }
  const hijas = (parentId: string | null) =>
    arbol
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  const salida: (Faceta & { nivel: number })[] = [];
  const recorrer = (parentId: string | null, nivel: number) => {
    for (const n of hijas(parentId)) {
      const count = total.get(n.id) ?? 0;
      if (count === 0) continue;
      salida.push({ label: n.nombre, count, nivel });
      recorrer(n.id, nivel + 1);
    }
  };
  recorrer(null, 1);
  return salida;
}

/** Productos por categoría propia (sólo la directa; `enArbolConConteo` suma hacia arriba). */
async function conteoPorCategoriaPropia(where: ReturnType<typeof condicionesDe>) {
  const filas = await getDb()
    .select({ id: crmOverlay.categoriaId, count: sql<number>`count(*)::int` })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay())
    .leftJoin(stockReservado, joinReserva())
    .where(and(where, sql`${crmOverlay.categoriaId} is not null`))
    .groupBy(crmOverlay.categoriaId);
  return new Map(filas.map((f) => [f.id as string, Number(f.count)]));
}

/** Qué grupos de filtros entran en un WHERE (ver `condicionesDe`). */
interface AplicarFiltros {
  categorias: boolean;
  marcas: boolean;
  precio: boolean;
  stock: boolean;
}

const APLICAR_TODOS: AplicarFiltros = {
  categorias: true,
  marcas: true,
  precio: true,
  stock: true,
};

/**
 * WHERE compartido por la página, el conteo y las facetas.
 *
 * `aplicar` dice qué grupos de filtros entran. La grilla los usa todos; cada
 * faceta excluye su propio grupo (ver `getFacetas`).
 */
function condicionesDe(filtros: FiltrosCatalogo, aplicar: AplicarFiltros, soloVisibles: boolean) {
  const q = filtros.busqueda?.trim();
  return and(
    enTenantCatalogo(),
    activoSql,
    conPrecioSql,
    soloVisiblesSql(soloVisibles),
    q ? coincideTexto(q) : undefined,
    aplicar.categorias && filtros.categorias?.length
      ? filtroCategoriasSql(filtros.categorias)
      : undefined,
    aplicar.marcas && filtros.marcas?.length
      ? inArray(marcaSql, filtros.marcas)
      : undefined,
    aplicar.precio && filtros.precioMin != null
      ? sql`${precioExhibidoSql} >= ${filtros.precioMin}`
      : undefined,
    aplicar.precio && filtros.precioMax != null
      ? sql`${precioExhibidoSql} <= ${filtros.precioMax}`
      : undefined,
    aplicar.stock && filtros.soloStock ? conStockSql : undefined,
  );
}

/**
 * ORDER BY según el criterio elegido. El default (`nombre`) es el alfabético.
 * El desempate por nombre mantiene la paginación estable (sin él, dos productos
 * del mismo precio pueden intercambiarse entre páginas).
 */
function ordenDe(orden: OrdenCatalogo) {
  switch (orden) {
    case "precio-asc":
      return [sql`${precioExhibidoSql} asc`, asc(crmCatalogo.name)];
    case "precio-desc":
      return [sql`${precioExhibidoSql} desc`, asc(crmCatalogo.name)];
    default:
      return [asc(crmCatalogo.name)];
  }
}

/** Página 1-based acotada al rango válido. */
export function acotarPagina(pagina: number, paginas: number): number {
  if (!Number.isFinite(pagina)) return 1;
  return Math.min(Math.max(Math.trunc(pagina), 1), Math.max(paginas, 1));
}

/**
 * Una página del catálogo, con los filtros y el orden resueltos en Postgres.
 *
 * Todo esto vivía en el cliente sobre el catálogo entero (~2800 productos por
 * request). Filtrar u ordenar después de paginar daría resultados incompletos,
 * así que las tres cosas se hacen acá, en la misma query.
 */
export async function getPaginaCatalogo(opts: {
  /** Flag `catalogo-solo-visibles` (ver `soloVisiblesSql`). */
  soloVisibles: boolean;
  filtros?: FiltrosCatalogo;
  orden?: OrdenCatalogo;
  /** 1-based. Si se pasa de largo, se devuelve la última página. */
  pagina?: number;
  porPagina?: number;
  idPriceList?: string;
}): Promise<PaginaCatalogo> {
  const filtros = opts.filtros ?? {};
  const porPagina = opts.porPagina ?? PRODUCTOS_POR_PAGINA;
  const where = condicionesDe(filtros, APLICAR_TODOS, opts.soloVisibles);

  const [conteo] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(crmCatalogo)
    .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
    .leftJoin(crmOverlay, joinOverlay())
    .leftJoin(stockReservado, joinReserva())
    .where(where);

  const total = conteo?.total ?? 0;
  const paginas = Math.max(Math.ceil(total / porPagina), 1);
  const pagina = acotarPagina(opts.pagina ?? 1, paginas);

  const filas = total
    ? await getDb()
        .select(COLUMNAS_CATALOGO)
        .from(crmCatalogo)
        .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
        .leftJoin(crmOverlay, joinOverlay())
        .leftJoin(stockReservado, joinReserva())
        .where(where)
        .orderBy(...ordenDe(opts.orden ?? ORDEN_DEFAULT))
        .limit(porPagina)
        .offset((pagina - 1) * porPagina)
    : [];

  return {
    productos: filas.map((f) => mapFilaToProduct(f, opts.idPriceList)),
    total,
    pagina,
    paginas,
  };
}

/**
 * Producto para la ficha pública, desde la vista del CRM (con el overlay, igual
 * que la card del catálogo). Nada de tráfico público toca Alegra: precio y stock
 * en vivo se validan recién al cotizar y al confirmar el pedido.
 *
 * `null` = no existe o no está publicado (404). Si falla la base, TIRA: un error
 * no puede presentarse como "no existe", o Google saca del índice productos reales.
 */
export async function getProducto(
  id: string,
  opts: {
    /** Flag `catalogo-solo-visibles` (ver `soloVisiblesSql`). */
    soloVisibles: boolean;
    idPriceList?: string;
  },
): Promise<Product | null> {
  // Un id que no es de Alegra no es un producto: ni se consulta.
  if (!esIdAlegra(id)) return null;
  const productos = await getProductosPorIds([id], {
    idPriceList: opts.idPriceList,
    soloActivos: true,
    soloVisibles: opts.soloVisibles,
  });
  return productos.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// Facetas y navegación
// ---------------------------------------------------------------------------

/** Una opcion de filtro con la cantidad real de productos que la cumplen. */
export interface Faceta {
  label: string;
  count: number;
  /** Sólo categorías con árbol propio: 1 = raíz. Sirve para sangrar la lista. */
  nivel?: number;
}

export interface Facetas {
  categorias: Faceta[];
  marcas: Faceta[];
  /**
   * Rango real de precios exhibidos del conjunto filtrado, sin el propio
   * filtro de precio (límites del slider). null = ningún producto cumple.
   */
  precio: RangoPrecio | null;
}

/**
 * Facetas con sus conteos, calculadas en Postgres.
 *
 * Cada faceta cuenta sobre lo que matchea la búsqueda MÁS los filtros de los
 * OTROS grupos, y no sobre el propio: las marcas se cuentan dentro de las
 * categorías tildadas (tildar "Herramientas" deja sólo las marcas que tienen
 * herramientas, con la cantidad que tienen), pero siguen mostrándose todas las
 * categorías disponibles para poder tildar otra sin destildar la primera. Con
 * el mismo criterio, el rango de precio se calcula sobre todo lo demás pero
 * sin el rango vigente: si no, los límites del slider se achicarían a lo que
 * el visitante acaba de elegir y ya no podría volver a abrirlo.
 */
export async function getFacetas(
  filtros: FiltrosCatalogo,
  /** Flag `catalogo-solo-visibles` (ver `soloVisiblesSql`). */
  soloVisibles: boolean,
): Promise<Facetas> {
  const whereCategorias = condicionesDe(filtros, { ...APLICAR_TODOS, categorias: false }, soloVisibles);
  const whereMarcas = condicionesDe(filtros, { ...APLICAR_TODOS, marcas: false }, soloVisibles);
  const wherePrecio = condicionesDe(filtros, { ...APLICAR_TODOS, precio: false }, soloVisibles);

  const arbol = await getArbolCategorias();

  const [categorias, marcas, [rango]] = await Promise.all([
    arbol.length
      ? conteoPorCategoriaPropia(whereCategorias).then((c) => enArbolConConteo(arbol, c))
      : getDb()
      .select({
        label: sql<string>`${crmCategoriasAlegra.name}`,
        count: sql<number>`count(*)::int`,
      })
      .from(crmCatalogo)
      .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
      .leftJoin(crmOverlay, joinOverlay())
      .leftJoin(stockReservado, joinReserva())
      .where(and(whereCategorias, sql`nullif(${crmCategoriasAlegra.name}, '') is not null`))
      .groupBy(crmCategoriasAlegra.name)
      .orderBy(sql`count(*) desc`, asc(crmCategoriasAlegra.name)),
    getDb()
      .select({ label: marcaSql, count: sql<number>`count(*)::int` })
      .from(crmCatalogo)
      .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
      .leftJoin(crmOverlay, joinOverlay())
      .leftJoin(stockReservado, joinReserva())
      .where(and(whereMarcas, sql`nullif(${marcaSql}, '') is not null`))
      .groupBy(marcaSql)
      .orderBy(sql`count(*) desc`, sql`${marcaSql} asc`),
    // Enteros hacia afuera (floor/ceil) para que ningún producto quede fuera
    // de los límites que muestra el slider.
    getDb()
      .select({
        min: sql<number | null>`floor(min(${precioExhibidoSql}))::int`,
        max: sql<number | null>`ceil(max(${precioExhibidoSql}))::int`,
      })
      .from(crmCatalogo)
      .leftJoin(crmCategoriasAlegra, joinCategoriasAlegra())
      .leftJoin(crmOverlay, joinOverlay())
      .leftJoin(stockReservado, joinReserva())
      .where(wherePrecio),
  ]);

  const precio =
    rango?.min != null && rango?.max != null
      ? { min: rango.min, max: rango.max }
      : null;

  return { categorias, marcas, precio };
}



/**
 * Categorías del catálogo, para la navegación (menú del header y grilla del
 * home). Salen del árbol propio del CRM si ya llegó, y si no de las de
 * Alegra; en los dos casos sin las que no tienen ningún producto — una
 * categoría vacía en el menú es un callejón sin salida.
 *
 * Envuelto en `cache` de React para consultarla una sola vez por request.
 * `soloVisibles`: flag `catalogo-solo-visibles` (ver `soloVisiblesSql`).
 */
export const getCategorias = cache(async function getCategorias(
  soloVisibles: boolean,
): Promise<string[]> {
  // Con árbol propio el menú muestra sus raíces, en el orden del CRM, contando
  // lo que se publica de verdad (mismo WHERE que la grilla sin filtros).
  const arbol = await getArbolCategorias();
  if (arbol.length) {
    const conteos = await conteoPorCategoriaPropia(condicionesDe({}, APLICAR_TODOS, soloVisibles));
    return enArbolConConteo(arbol, conteos)
      .filter((c) => c.nivel === 1)
      .map((c) => c.label);
  }

  // Sin árbol: categorías de Alegra activas con al menos un producto activo del
  // tenant. Las dos vistas son de todos los tenants: el tenant va en el ON (el
  // producto y su categoría, del mismo tenant) y en el WHERE de las dos.
  const tenant = shopTenantId();
  const filas = await getDb()
    .selectDistinct({ name: crmCategoriasAlegra.name })
    .from(crmCategoriasAlegra)
    .innerJoin(
      crmCatalogo,
      and(
        eq(crmCatalogo.categoryAlegraId, crmCategoriasAlegra.alegraId),
        eq(crmCatalogo.tenantId, crmCategoriasAlegra.tenantId),
      ),
    )
    .where(
      and(
        eq(crmCategoriasAlegra.tenantId, tenant),
        eq(crmCatalogo.tenantId, tenant),
        eq(crmCategoriasAlegra.activo, true),
        activoSql,
      ),
    )
    .orderBy(asc(crmCategoriasAlegra.name));

  return filas.map((f) => f.name).filter(Boolean);
});
