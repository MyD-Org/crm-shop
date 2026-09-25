/**
 * Lecturas PÚBLICAS del catálogo cacheadas (Cache Components,
 * `'use cache: remote'` = Runtime Cache de Vercel, compartida entre
 * instancias). Las usan los huecos por request del header (nav), la home
 * (destacados), el catálogo y la ficha: así un visitante anónimo no despierta
 * la base y el listado sale en milisegundos.
 *
 * Reglas (ver docs/arquitectura-integraciones.md, "Caché de datos"):
 * - Sólo datos que son iguales para todos: precio de la lista principal,
 *   stock disponible, curaduría. Nada del visitante (identidad, lista de
 *   precios del cliente, favoritos) entra en la clave ni en el valor. El
 *   carrito, la cotización, el checkout y el pedido NO pasan por acá: cotizan
 *   del espejo en vivo (src/lib/cotizacion.ts).
 * - Los flags llegan como argumento (`flagsPublicos()`, evaluado por request
 *   afuera): son parte de la clave.
 * - Tag `catalogo` (src/lib/cache-tags.ts) y perfil `catalogo` de
 *   next.config.ts (expire 15 min = TTL de seguridad). Lo invalidan el aviso
 *   del CRM (`/api/internal/catalogo/revalidar`, al terminar la sync o un
 *   drenaje de stock con cambios, y al guardar overlay/categorías) y los
 *   pedidos del Shop (reservan o liberan stock).
 * - Las lecturas con muchos valores posibles (búsqueda por texto, rango de
 *   precio) NO se cachean: cada una sería una entrada nueva que casi nunca se
 *   vuelve a pedir (sólo gasta escrituras de la cuota).
 * - Cada función loguea `[cache] <nombre> miss` en su cuerpo: sólo corre
 *   cuando no hubo acierto. Es la forma de verificar la caché en los logs.
 *
 * Plan B (cuota de Runtime Cache): cambiar `'use cache: remote'` por
 * `'use cache'` en este archivo (y en src/lib/cuotas-datos.ts). Sigue siendo
 * correcto; sólo baja el acierto entre instancias.
 */
import { cacheLife, cacheTag } from "next/cache";
import type { Product } from "@/data/products";
import { esIdAlegra } from "./alegra";
import {
  getCatalogo,
  getCategorias,
  getFacetas,
  getPaginaCatalogo,
  getProducto,
  type Facetas,
  type FiltrosCatalogo,
  type PaginaCatalogo,
} from "./catalog";
import { TAG_CATALOGO } from "./cache-tags";
import type { OrdenCatalogo } from "./catalogo-url";
import { elegirDestacados } from "./destacados";

/** Categoría de Alegra que alimenta los destacados de la home. */
const CATEGORIA_DESTACADOS = "ILUMINACION";
/** Respaldo para SKUs curados que no sean de esa categoría. */
const LIMITE_RESPALDO_DESTACADOS = 300;

/**
 * ¿Vale la pena cachear esta combinación de filtros? No con búsqueda por
 * texto ni rango de precio: tienen demasiados valores posibles y casi nunca
 * se repiten (ver la guía de `use cache: remote`, "Cache key considerations").
 */
export function filtrosCacheables(filtros: FiltrosCatalogo): boolean {
  return !filtros.busqueda?.trim() && filtros.precioMin == null && filtros.precioMax == null;
}

export interface ArgsPaginaPublica {
  filtros: FiltrosCatalogo;
  orden: OrdenCatalogo;
  pagina: number;
  soloVisibles: boolean;
}

async function paginaCacheada(args: ArgsPaginaPublica): Promise<PaginaCatalogo> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  cacheLife("catalogo");
  console.info("[cache] catalogo-pagina miss");
  return getPaginaCatalogo(args);
}

/**
 * Una página del catálogo público. Si la base falla, TIRA (el error no se
 * cachea): la página muestra su error en vez de un catálogo vacío.
 */
export function paginaCatalogoPublica(args: ArgsPaginaPublica): Promise<PaginaCatalogo> {
  return filtrosCacheables(args.filtros) ? paginaCacheada(args) : getPaginaCatalogo(args);
}

async function facetasCacheadas(filtros: FiltrosCatalogo, soloVisibles: boolean): Promise<Facetas> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  cacheLife("catalogo");
  console.info("[cache] catalogo-facetas miss");
  return getFacetas(filtros, soloVisibles);
}

/** Facetas del catálogo público (mismo criterio de cacheo que la página). */
export function facetasPublicas(filtros: FiltrosCatalogo, soloVisibles: boolean): Promise<Facetas> {
  return filtrosCacheables(filtros)
    ? facetasCacheadas(filtros, soloVisibles)
    : getFacetas(filtros, soloVisibles);
}

async function productoCacheado(id: string, soloVisibles: boolean): Promise<Product | null> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  cacheLife("catalogo");
  console.info("[cache] producto miss");
  return getProducto(id, { soloVisibles });
}

/**
 * Producto para la ficha pública. `null` = no existe o no está publicado
 * (también se cachea: el 404 de un producto real se corrige con el aviso del
 * CRM o a los 15 minutos). Un id que no es de Alegra ni llega a la caché (los
 * bots que prueban rutas no la llenan). Si la base falla, TIRA y no se cachea.
 */
export function productoPublico(id: string, soloVisibles: boolean): Promise<Product | null> {
  if (!esIdAlegra(id)) return Promise.resolve(null);
  return productoCacheado(id, soloVisibles);
}

/**
 * Categorías del menú del header. Si la base falla, vacío (el header se
 * renderiza igual) y guardado sólo con el perfil `degradado` (minutos).
 */
export async function categoriasNav(soloVisibles: boolean): Promise<string[]> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  console.info("[cache] categorias-nav miss");
  try {
    const categorias = await getCategorias(soloVisibles);
    cacheLife("catalogo");
    return categorias;
  } catch (err) {
    console.error("[catalogo-publico] no se pudieron cargar las categorías del nav:", err);
    cacheLife("degradado");
    return [];
  }
}

/**
 * Productos destacados de la home: los SKUs curados en el editor primero y el
 * resto completado con Iluminación (ver `elegirDestacados`). Si alguna lectura
 * falla, la home degrada a lo que se pudo leer (o a la grilla vacía) y ese
 * resultado se guarda sólo con el perfil `degradado`.
 */
export async function destacadosHome(args: {
  skus: string[];
  cantidad: number;
  soloVisibles: boolean;
}): Promise<Product[]> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  console.info("[cache] destacados miss");
  const { skus, cantidad, soloVisibles } = args;
  let fallo = false;
  const registrar = (err: unknown) => {
    fallo = true;
    console.error("[catalogo-publico] no se pudieron cargar los destacados:", err);
  };
  const [iluminacion, general] = await Promise.all([
    getPaginaCatalogo({ filtros: { categorias: [CATEGORIA_DESTACADOS] }, pagina: 1, soloVisibles }).catch(
      (err: unknown): { productos: Product[] } => {
        registrar(err);
        return { productos: [] };
      },
    ),
    skus.length
      ? getCatalogo({ limit: LIMITE_RESPALDO_DESTACADOS, soloVisibles }).catch((err: unknown): Product[] => {
          registrar(err);
          return [];
        })
      : Promise.resolve([] as Product[]),
  ]);
  if (fallo) cacheLife("degradado");
  else cacheLife("catalogo");

  const vistos = new Set(iluminacion.productos.map((p) => p.id));
  const pool = [...iluminacion.productos, ...general.filter((p) => !vistos.has(p.id))];
  return elegirDestacados(pool, skus, cantidad);
}
