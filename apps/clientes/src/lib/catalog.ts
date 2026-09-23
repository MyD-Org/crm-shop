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
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { ProductStock } from "@myd-org/ui";
import { getDb } from "@/db";
import { catalogCategories, catalogProducts } from "@/db/schema";
import { crmCategorias, crmOverlay, type FotoCrm } from "@/db/crm";
import {
  esIdAlegra,
  precioDeLista,
  type AlegraPrice,
} from "./alegra";
import { ORDEN_DEFAULT, type OrdenCatalogo, type RangoPrecio } from "./catalogo-url";
import { catalogoSoloVisibles } from "./catalogo-flag";
import { fotosPermitidas, hostsDeMedios } from "./catalogo-medios";
import { basePublicaMedios } from "./shop-media";
import { shopTenantId } from "./tenant";
import { precioFinal } from "./precio-final";
import { stockSimulado } from "./stock-simulado";
import type { Product } from "@/data/products";

/** Debajo de esta cantidad, el stock se muestra como "bajo". */
const STOCK_BAJO = 5;

/**
 * Deriva el estado de stock del shop a partir de una cantidad de inventario.
 * - null/undefined (servicio / no inventariable) → siempre disponible.
 * - >= STOCK_BAJO = "in", >0 = "low", 0 = "out".
 */
export function derivarStock(
  qty: number | null | undefined,
  /** Ver `stockSimulado()`. Parámetro y no lectura del entorno, para poder
   *  testear las dos ramas sin ensuciar `process.env`. */
  simular = false,
): ProductStock {
  if (qty == null) return "in";
  /**
   * Con la simulación activa, "sin stock" pasa a "disponible".
   *
   * Hace falta ACÁ además de en la cotización: el botón "agregar al carrito"
   * está deshabilitado cuando el estado es "out"
   * (CatalogoClient.tsx y ProductoClient.tsx), así que simular solo del lado
   * del cotizador dejaba la tienda igual de intransitable — no se podía meter
   * un producto en el carrito para llegar a cotizarlo.
   */
  if (qty <= 0) return simular ? "in" : "out";
  if (qty < STOCK_BAJO) return "low";
  return "in";
}

// ---------------------------------------------------------------------------
// Lectura desde el espejo local
// ---------------------------------------------------------------------------

/** Fila del join productos × categorías × overlay, tal como la devuelve la query. */
interface FilaCatalogo {
  alegraId: string;
  name: string;
  code: string | null;
  description: string | null;
  brand: string | null;
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
  const simular = stockSimulado();
  const price = precioDeLista(fila.prices as AlegraPrice[] | undefined, idPriceList);
  return {
    id: fila.alegraId,
    // La marca sale del customField de Alegra; si no está cargado, cae al
    // nombre de la categoría (mismo criterio que la ficha en vivo).
    brand: fila.brand || fila.categoryName || "",
    // Nombre exhibido: el curado en el CRM; si no, la descripción de Alegra
    // (en esta cuenta el nombre comercial vive ahí); si no, `name`, que en
    // esta cuenta es el código. `||` y no `??`: un texto vacío no pisa.
    name: fila.overlayNombre || fila.description || fila.name,
    price,
    ...camposIva(price, fila.ivaPorcentaje != null ? Number(fila.ivaPorcentaje) : null),
    stock: derivarStock(qty, simular),
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

/** Condición del join productos × categorías, compartida por todas las queries. */
const JOIN_CATEGORIAS = eq(
  catalogProducts.categoryAlegraId,
  catalogCategories.alegraId
);

/**
 * Join al overlay del CRM (esparso: left join, la mayoría de los productos no
 * tiene fila). La tabla es de todos los tenants del CRM: el tenant va en el
 * join, no en el WHERE, para no convertirlo en un inner join. Función y no
 * constante: el tenant se lee del entorno en cada consulta.
 */
const joinOverlay = () =>
  and(eq(crmOverlay.alegraId, catalogProducts.alegraId), eq(crmOverlay.tenantId, shopTenantId()));

/**
 * Sólo productos publicados en el CRM, detrás del flag
 * `SHOP_CATALOGO_SOLO_VISIBLES` (apagado por defecto). Fail-closed: sin fila
 * de overlay el left join deja `visible` en NULL y el producto queda afuera,
 * así que con el flag prendido y sin curaduría la tienda queda vacía. Se
 * evalúa por consulta (no al cargar el módulo) para respetar el env vigente.
 */
function soloVisiblesSql() {
  return catalogoSoloVisibles() ? eq(crmOverlay.visible, true) : undefined;
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
  ivaPorcentaje: catalogProducts.ivaPorcentaje,
  categoryName: catalogCategories.name,
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
 * a mano; las tablas las califica drizzle desde `pgSchema("shop")`.
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
    .leftJoin(catalogCategories, JOIN_CATEGORIAS)
    .leftJoin(crmOverlay, joinOverlay())
    .where(
      and(
        eq(catalogProducts.status, "active"),
        conPrecioSql,
        soloVisiblesSql(),
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
 * Productos del espejo por id de Alegra, para las líneas de pedido de Mi
 * cuenta (y favoritos). Una sola consulta por llamada: quien tiene N líneas
 * junta los ids y llama una vez, nunca una por línea.
 *
 * Sin filtro de estado por default: un pedido viejo sigue mostrando el nombre
 * real de un ítem que después se despublicó. `soloActivos` aplica
 * `status = 'active'` y, con el flag `SHOP_CATALOGO_SOLO_VISIBLES`, también
 * `visible` (mismo criterio que la lista pública).
 *
 * Sin `orderBy` (el orden lo decide quien llama: pedidos por línea, favoritos
 * por fecha) y sin `limit` (los ids ya vienen acotados por quien llama). Un id
 * que el espejo no tiene simplemente no aparece en el `Map`.
 */
export async function getProductosPorIds(
  alegraIds: readonly string[],
  opts?: { idPriceList?: string; soloActivos?: boolean },
): Promise<Map<string, Product>> {
  if (alegraIds.length === 0) return new Map();

  const filas = await getDb()
    .select(COLUMNAS_CATALOGO)
    .from(catalogProducts)
    .leftJoin(catalogCategories, JOIN_CATEGORIAS)
    .leftJoin(crmOverlay, joinOverlay())
    .where(
      and(
        inArray(catalogProducts.alegraId, [...alegraIds]),
        opts?.soloActivos ? eq(catalogProducts.status, "active") : undefined,
        opts?.soloActivos ? soloVisiblesSql() : undefined,
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
const marcaSql = sql<string>`coalesce(nullif(${catalogProducts.brand}, ''), ${catalogCategories.name})`;

/**
 * Precio de lista principal, extraído del jsonb `prices`. Equivalente en SQL de
 * `precioDeLista` sin lista de cliente: el que tiene `main`, si no el primero.
 * El guard de `jsonb_typeof` evita que `jsonb_array_elements` explote si algún
 * ítem quedó con un `prices` que no es array.
 */
const precioSql = sql<string>`coalesce(
  case when jsonb_typeof(${catalogProducts.prices}) = 'array' then (
    select (elem->>'price')::numeric
    from jsonb_array_elements(${catalogProducts.prices}) elem
    where (elem->>'main')::boolean
    limit 1
  ) end,
  case when jsonb_typeof(${catalogProducts.prices}) = 'array'
    then (${catalogProducts.prices}->0->>'price')::numeric end,
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
const precioExhibidoSql = sql<string>`${precioSql} * (1 + coalesce(${catalogProducts.ivaPorcentaje}, 0) / 100)`;

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
const conStockSql = sql`(${catalogProducts.stock} is null or ${catalogProducts.stock} > 0)`;

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
    or (not ${hayArbolSql()} and ${inArray(catalogCategories.name, nombres)}))`;
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
    .from(catalogProducts)
    .leftJoin(catalogCategories, JOIN_CATEGORIAS)
    .leftJoin(crmOverlay, joinOverlay())
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
 *
 * El filtro de stock se OMITE mientras la simulación de disponibilidad está
 * activa (`stockSimulado()`): con ella todo se muestra "disponible", y filtrar
 * por `stock > 0` escondería productos que la card dice que están.
 */
function condicionesDe(filtros: FiltrosCatalogo, aplicar: AplicarFiltros) {
  const q = filtros.busqueda?.trim();
  return and(
    eq(catalogProducts.status, "active"),
    conPrecioSql,
    soloVisiblesSql(),
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
    aplicar.stock && filtros.soloStock && !stockSimulado()
      ? conStockSql
      : undefined,
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
      return [sql`${precioExhibidoSql} asc`, asc(catalogProducts.name)];
    case "precio-desc":
      return [sql`${precioExhibidoSql} desc`, asc(catalogProducts.name)];
    default:
      return [asc(catalogProducts.name)];
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
export async function getPaginaCatalogo(opts?: {
  filtros?: FiltrosCatalogo;
  orden?: OrdenCatalogo;
  /** 1-based. Si se pasa de largo, se devuelve la última página. */
  pagina?: number;
  porPagina?: number;
  idPriceList?: string;
}): Promise<PaginaCatalogo> {
  const filtros = opts?.filtros ?? {};
  const porPagina = opts?.porPagina ?? PRODUCTOS_POR_PAGINA;
  const where = condicionesDe(filtros, APLICAR_TODOS);

  const [conteo] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(catalogProducts)
    .leftJoin(catalogCategories, JOIN_CATEGORIAS)
    .leftJoin(crmOverlay, joinOverlay())
    .where(where);

  const total = conteo?.total ?? 0;
  const paginas = Math.max(Math.ceil(total / porPagina), 1);
  const pagina = acotarPagina(opts?.pagina ?? 1, paginas);

  const filas = total
    ? await getDb()
        .select(COLUMNAS_CATALOGO)
        .from(catalogProducts)
        .leftJoin(catalogCategories, JOIN_CATEGORIAS)
        .leftJoin(crmOverlay, joinOverlay())
        .where(where)
        .orderBy(...ordenDe(opts?.orden ?? ORDEN_DEFAULT))
        .limit(porPagina)
        .offset((pagina - 1) * porPagina)
    : [];

  return {
    productos: filas.map((f) => mapFilaToProduct(f, opts?.idPriceList)),
    total,
    pagina,
    paginas,
  };
}

/**
 * Producto para la ficha pública, desde el espejo (con el overlay del CRM, igual
 * que la card del catálogo). Nada de tráfico público toca Alegra: precio y stock
 * en vivo se validan recién al cotizar y al confirmar el pedido.
 *
 * `null` = no existe o no está publicado (404). Si falla la base, TIRA: un error
 * no puede presentarse como "no existe", o Google saca del índice productos reales.
 */
export async function getProducto(
  id: string,
  idPriceList?: string
): Promise<Product | null> {
  // Un id que no es de Alegra no es un producto: ni se consulta.
  if (!esIdAlegra(id)) return null;
  const productos = await getProductosPorIds([id], { idPriceList, soloActivos: true });
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
export async function getFacetas(filtros: FiltrosCatalogo = {}): Promise<Facetas> {
  const whereCategorias = condicionesDe(filtros, { ...APLICAR_TODOS, categorias: false });
  const whereMarcas = condicionesDe(filtros, { ...APLICAR_TODOS, marcas: false });
  const wherePrecio = condicionesDe(filtros, { ...APLICAR_TODOS, precio: false });

  const arbol = await getArbolCategorias();

  const [categorias, marcas, [rango]] = await Promise.all([
    arbol.length
      ? conteoPorCategoriaPropia(whereCategorias).then((c) => enArbolConConteo(arbol, c))
      : getDb()
      .select({
        label: sql<string>`${catalogCategories.name}`,
        count: sql<number>`count(*)::int`,
      })
      .from(catalogProducts)
      .leftJoin(catalogCategories, JOIN_CATEGORIAS)
      .leftJoin(crmOverlay, joinOverlay())
      .where(and(whereCategorias, sql`nullif(${catalogCategories.name}, '') is not null`))
      .groupBy(catalogCategories.name)
      .orderBy(sql`count(*) desc`, asc(catalogCategories.name)),
    getDb()
      .select({ label: marcaSql, count: sql<number>`count(*)::int` })
      .from(catalogProducts)
      .leftJoin(catalogCategories, JOIN_CATEGORIAS)
      .leftJoin(crmOverlay, joinOverlay())
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
      .from(catalogProducts)
      .leftJoin(catalogCategories, JOIN_CATEGORIAS)
      .leftJoin(crmOverlay, joinOverlay())
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
 */
export const getCategorias = cache(async function getCategorias(): Promise<
  string[]
> {
  // Con árbol propio el menú muestra sus raíces, en el orden del CRM, contando
  // lo que se publica de verdad (mismo WHERE que la grilla sin filtros).
  const arbol = await getArbolCategorias();
  if (arbol.length) {
    const conteos = await conteoPorCategoriaPropia(condicionesDe({}, APLICAR_TODOS));
    return enArbolConConteo(arbol, conteos)
      .filter((c) => c.nivel === 1)
      .map((c) => c.label);
  }

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
