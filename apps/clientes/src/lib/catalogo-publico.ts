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
 * - Con el flag `disponibilidad-sucursal`, la sucursal de la zona del visitante
 *   (y sus reglas) llega como argumento `disp` (`ContextoDisponibilidad`): NUNCA
 *   se lee la cookie adentro de un scope cacheado. Una entrada por sucursal de
 *   zona; sin `disp` (flag apagado) la clave y el resultado son los de siempre.
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
 * - Si la lectura cacheada misma falla (la Runtime Cache tiró "Connection
 *   closed." en prod), se lee lo mismo sin caché (`conRespaldoSinCache`).
 *
 * Plan B (cuota de Runtime Cache): cambiar `'use cache: remote'` por
 * `'use cache'` en este archivo. Sigue siendo
 * correcto; sólo baja el acierto entre instancias.
 */
import { cacheLife, cacheTag } from "next/cache";
import type { Product } from "@/data/products";
import { esIdAlegra } from "./alegra";
import {
  getCatalogo,
  getCategoriaExacta,
  getCategorias,
  getFacetas,
  getFacetaCategorias,
  getPaginaCatalogo,
  getProducto,
  getRutaCategoriaPropia,
  type Faceta,
  type Facetas,
  type FiltrosCatalogo,
  type PaginaCatalogo,
} from "./catalog";
import { conRespaldoSinCache } from "./cache-respaldo";
import { TAG_CATALOGO } from "./cache-tags";
import { esMedidaId } from "./catalogo-atributos-medida";
import { leerIdCar } from "./catalogo-car";
import { SOLO_STOCK_DEFAULT, type OrdenCatalogo } from "./catalogo-url";
import { elegirDestacados } from "./destacados";
import type { ContextoDisponibilidad } from "./disponibilidad-contexto";
import type { MedioCuotas } from "./cuotas-sin-interes";
import { SIN_MEDIOS_PRECIO, type MedioPrecio } from "./medios-precio";

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
  return (
    // El texto (`texto`) es una consulta libre, en cualquiera de sus formas (y el plan de la búsqueda
    // v2 sale de ella): tantas claves como búsquedas.
    !filtros.texto?.q.trim() &&
    !filtros.texto?.plan &&
    !filtros.texto?.tolerante &&
    !filtros.texto?.codigo &&
    // Una medida (`corriente_a:20`) tiene tantos valores posibles como el precio: una clave por cada uno.
    !filtros.atributos?.some(esMedidaId) &&
    filtros.precioMin == null &&
    filtros.precioMax == null &&
    // La potencia es un rango libre como el precio: multiplicaría las claves de la caché.
    filtros.potenciaMin == null &&
    filtros.potenciaMax == null &&
    // Un `car` de rango (`flujo_lm:800-1200`) es un rango libre; los de lista (`polos:2`) son pocos
    // valores por categoría y entran en la clave con el resto de los filtros (y el flag `facetasPorTipo`).
    !filtros.caracteristicas?.some((id) => leerIdCar(id)?.op === "rango")
  );
}

export interface ArgsPaginaPublica {
  filtros: FiltrosCatalogo;
  orden: OrdenCatalogo;
  pagina: number;
  soloVisibles: boolean;
  /** Flag `disponibilidad-sucursal` (ver `ContextoDisponibilidad`). */
  disp?: ContextoDisponibilidad;
  /**
   * Medio destacado ("$X con <Medio>" en las cards). Argumento y no lectura adentro: es parte de la
   * clave de la caché, así cambiar el enlace o el destacado se ve aunque el ping falle.
   */
  destacado?: MedioPrecio | null;
  /** Cuotas sin interés de las cards (flag `cuotas-cobro`): también parte de la clave de la caché. */
  cuotas?: MedioCuotas[] | null;
}

async function paginaCacheada(args: ArgsPaginaPublica): Promise<PaginaCatalogo> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  cacheLife("catalogo");
  console.info("[cache] catalogo-pagina miss");
  return getPaginaCatalogo(conMedios(args));
}

/** Los medios que dibujan las cards: el destacado y las cuotas sin interés (la ficha va aparte). */
function conMedios<T extends { destacado?: MedioPrecio | null; cuotas?: MedioCuotas[] | null }>(
  args: T,
): Omit<T, "destacado" | "cuotas"> & {
  mediosPrecio?: { destacado: MedioPrecio | null; ficha: MedioPrecio[]; cuotas?: MedioCuotas[] };
} {
  const { destacado, cuotas, ...resto } = args;
  return destacado || cuotas?.length
    ? { ...resto, mediosPrecio: { ...SIN_MEDIOS_PRECIO, destacado: destacado ?? null, ...(cuotas?.length ? { cuotas } : {}) } }
    : resto;
}

/**
 * Una página del catálogo público. Si la base falla, TIRA (el error no se
 * cachea): la página muestra su error en vez de un catálogo vacío.
 */
export function paginaCatalogoPublica(args: ArgsPaginaPublica): Promise<PaginaCatalogo> {
  const directa = () => getPaginaCatalogo(conMedios(args));
  return filtrosCacheables(args.filtros)
    ? conRespaldoSinCache("catalogo-pagina", () => paginaCacheada(args), directa)
    : directa();
}

async function facetasCacheadas(
  filtros: FiltrosCatalogo,
  soloVisibles: boolean,
  disp?: ContextoDisponibilidad,
): Promise<Facetas> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  console.info("[cache] catalogo-facetas miss");
  const facetas = disp ? await getFacetas(filtros, soloVisibles, disp) : await getFacetas(filtros, soloVisibles);
  // Facetas por tipo pedidas que no salieron (la consulta falló y degradó): no se guardan por el TTL del catálogo.
  cacheLife(filtros.facetasPorTipo && facetas.porClave === undefined ? "degradado" : "catalogo");
  return facetas;
}

/** Facetas del catálogo público (mismo criterio de cacheo que la página). */
export function facetasPublicas(
  filtros: FiltrosCatalogo,
  soloVisibles: boolean,
  disp?: ContextoDisponibilidad,
): Promise<Facetas> {
  const directa = () => (disp ? getFacetas(filtros, soloVisibles, disp) : getFacetas(filtros, soloVisibles));
  return filtrosCacheables(filtros)
    ? conRespaldoSinCache("catalogo-facetas", () => facetasCacheadas(filtros, soloVisibles, disp), directa)
    : directa();
}

async function categoriasTotalesCacheadas(
  soloVisibles: boolean,
  disp?: ContextoDisponibilidad,
): Promise<Faceta[]> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  cacheLife("catalogo");
  console.info("[cache] catalogo-categorias-totales miss");
  const filtros = { soloStock: SOLO_STOCK_DEFAULT };
  return disp ? getFacetaCategorias(filtros, soloVisibles, disp) : getFacetaCategorias(filtros, soloVisibles);
}

/**
 * El árbol de categorías del panel de filtros con el TOTAL FIJO de cada una: el del catálogo sin
 * búsqueda ni otros filtros (sólo visibilidad y el default de stock). No depende de lo que el
 * visitante busca ni filtre, así que es una sola clave de la caché compartida (tag `catalogo`) y
 * no suma consultas por request. Si la base falla, TIRA (no se cachea).
 */
export function categoriasTotalesPublicas(soloVisibles: boolean, disp?: ContextoDisponibilidad): Promise<Faceta[]> {
  const directa = () =>
    disp
      ? getFacetaCategorias({ soloStock: SOLO_STOCK_DEFAULT }, soloVisibles, disp)
      : getFacetaCategorias({ soloStock: SOLO_STOCK_DEFAULT }, soloVisibles);
  return conRespaldoSinCache("catalogo-categorias-totales", () => categoriasTotalesCacheadas(soloVisibles, disp), directa);
}

async function productoCacheado(
  id: string,
  soloVisibles: boolean,
  disp?: ContextoDisponibilidad,
  /** Con características estructuradas (va en la clave de la caché). */
  estructurados = false,
  /** Medios de la ficha ("$X con <Medio>"): argumento, es parte de la clave de la caché. */
  ficha: readonly MedioPrecio[] = [],
  /** Cuotas sin interés de la ficha (flag `cuotas-cobro`): también parte de la clave. */
  cuotas: MedioCuotas[] | null = null,
): Promise<Product | null> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  cacheLife("catalogo");
  console.info("[cache] producto miss");
  return leerProducto(id, soloVisibles, disp, estructurados, ficha, cuotas);
}

function leerProducto(
  id: string,
  soloVisibles: boolean,
  disp: ContextoDisponibilidad | undefined,
  estructurados: boolean,
  ficha: readonly MedioPrecio[],
  cuotas: MedioCuotas[] | null,
): Promise<Product | null> {
  return getProducto(id, {
    soloVisibles,
    disp,
    ...(estructurados ? { atributosEstructurados: true } : {}),
    ...(ficha.length || cuotas?.length ? { mediosPrecio: { destacado: null, ficha: [...ficha], ...(cuotas?.length ? { cuotas } : {}) } } : {}),
  });
}

/**
 * Producto para la ficha pública. `null` = no existe o no está publicado
 * (también se cachea: el 404 de un producto real se corrige con el aviso del
 * CRM o a los 15 minutos). Un id que no es de Alegra ni llega a la caché (los
 * bots que prueban rutas no la llenan). Si la base falla, TIRA y no se cachea.
 */
export function productoPublico(
  id: string,
  soloVisibles: boolean,
  disp?: ContextoDisponibilidad,
  /**
   * Sumar las características de `catalog_atributos` (flag `busqueda-ia` + tabla disponible, ver
   * `atributosEstructuradosDisponibles`). Sin él, el producto de siempre.
   */
  estructurados = false,
  /** Medios de la ficha (`flagsPublicos().mediosPrecio.ficha`): "$X con <Medio>" por cada uno. */
  ficha: readonly MedioPrecio[] = [],
  /** Cuotas sin interés (`flagsPublicos().mediosPrecio.cuotas`): la ficha muestra la línea y el modal. */
  cuotas: MedioCuotas[] | null = null,
): Promise<Product | null> {
  if (!esIdAlegra(id)) return Promise.resolve(null);
  const cacheada = () =>
    ficha.length || cuotas?.length
      ? productoCacheado(id, soloVisibles, disp, estructurados, ficha, cuotas)
      : estructurados
        ? productoCacheado(id, soloVisibles, disp, true)
        : productoCacheado(id, soloVisibles, disp);
  return conRespaldoSinCache("producto", cacheada, () => leerProducto(id, soloVisibles, disp, estructurados, ficha, cuotas));
}

/**
 * Migas de la ficha: la categoría propia del producto con las que la
 * contienen (raíz → hoja). Si la base falla, vacío (la ficha cae a la
 * categoría de Alegra) y guardado sólo con el perfil `degradado`.
 */
export function rutaCategoriaPublica(categoriaId: string): Promise<string[]> {
  return conRespaldoSinCache(
    "ruta-categoria",
    () => rutaCategoriaCacheada(categoriaId),
    () => getRutaCategoriaPropia(categoriaId).catch(() => []),
  );
}

async function rutaCategoriaCacheada(categoriaId: string): Promise<string[]> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  console.info("[cache] ruta-categoria miss");
  try {
    const ruta = await getRutaCategoriaPropia(categoriaId);
    cacheLife("catalogo");
    return ruta;
  } catch (err) {
    console.error("[catalogo-publico] no se pudo leer la ruta de la categoría:", err);
    cacheLife("degradado");
    return [];
  }
}

/**
 * Categorías del menú del header. Si la base falla, vacío (el header se
 * renderiza igual) y guardado sólo con el perfil `degradado` (minutos).
 */
export function categoriasNav(soloVisibles: boolean, disp?: ContextoDisponibilidad): Promise<string[]> {
  return conRespaldoSinCache(
    "categorias-nav",
    () => categoriasNavCacheadas(soloVisibles, disp),
    () => (disp ? getCategorias(soloVisibles, disp) : getCategorias(soloVisibles)).catch(() => []),
  );
}

async function categoriasNavCacheadas(soloVisibles: boolean, disp?: ContextoDisponibilidad): Promise<string[]> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  console.info("[cache] categorias-nav miss");
  try {
    const categorias = disp ? await getCategorias(soloVisibles, disp) : await getCategorias(soloVisibles);
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
interface ArgsDestacados {
  skus: string[];
  cantidad: number;
  soloVisibles: boolean;
  disp?: ContextoDisponibilidad;
  /** Medio destacado de las cards (argumento: parte de la clave de la caché). */
  destacado?: MedioPrecio | null;
  /** Cuotas sin interés de las cards (flag `cuotas-cobro`). */
  cuotas?: MedioCuotas[] | null;
}

export function destacadosHome(args: ArgsDestacados): Promise<Product[]> {
  return conRespaldoSinCache(
    "destacados",
    () => destacadosCacheados(args),
    async () => (await leerDestacados(args)).productos,
  );
}

async function destacadosCacheados(args: ArgsDestacados): Promise<Product[]> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  console.info("[cache] destacados miss");
  const { productos, fallo } = await leerDestacados(args);
  if (fallo) cacheLife("degradado");
  else cacheLife("catalogo");
  return productos;
}

async function leerDestacados(args: ArgsDestacados): Promise<{ productos: Product[]; fallo: boolean }> {
  const { skus, cantidad, soloVisibles, disp } = args;
  const { mediosPrecio } = conMedios(args);
  let fallo = false;
  const registrar = (err: unknown) => {
    fallo = true;
    console.error("[catalogo-publico] no se pudieron cargar los destacados:", err);
  };
  const [iluminacion, general] = await Promise.all([
    getPaginaCatalogo({ filtros: { categorias: [CATEGORIA_DESTACADOS] }, pagina: 1, soloVisibles, disp, mediosPrecio }).catch(
      (err: unknown): { productos: Product[] } => {
        registrar(err);
        return { productos: [] };
      },
    ),
    skus.length
      ? getCatalogo({ limit: LIMITE_RESPALDO_DESTACADOS, soloVisibles, disp, mediosPrecio }).catch((err: unknown): Product[] => {
          registrar(err);
          return [];
        })
      : Promise.resolve([] as Product[]),
  ]);
  const vistos = new Set(iluminacion.productos.map((p) => p.id));
  const pool = [...iluminacion.productos, ...general.filter((p) => !vistos.has(p.id))];
  return { productos: elegirDestacados(pool, skus, cantidad), fallo };
}

async function primeraPaginaCategoria(
  categoria: string,
  soloVisibles: boolean,
  disp?: ContextoDisponibilidad,
  destacado: MedioPrecio | null = null,
  cuotas: MedioCuotas[] | null = null,
): Promise<Product[]> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  console.info("[cache] categoria-relacionados miss");
  try {
    const { productos } = await getPaginaCatalogo({
      filtros: { categorias: [categoria] },
      pagina: 1,
      soloVisibles,
      disp,
      ...conMedios({ destacado, cuotas }),
    });
    cacheLife("catalogo");
    return productos;
  } catch (err) {
    console.error("[catalogo-publico] no se pudieron cargar los relacionados:", err);
    cacheLife("degradado");
    return [];
  }
}

/** Tope de la caché por categoría exacta: alcanza para `cantidad` + el propio producto. */
const TOPE_CATEGORIA_EXACTA = 24;

async function categoriaExacta(
  categoriaId: string,
  soloVisibles: boolean,
  disp?: ContextoDisponibilidad,
  destacado: MedioPrecio | null = null,
  cuotas: MedioCuotas[] | null = null,
): Promise<{ nombre: string; productos: Product[] } | null> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  console.info("[cache] categoria-exacta miss");
  try {
    const r = await getCategoriaExacta({
      categoriaId,
      limit: TOPE_CATEGORIA_EXACTA,
      soloVisibles,
      disp,
      ...conMedios({ destacado, cuotas }),
    });
    cacheLife("catalogo");
    return r;
  } catch (err) {
    console.error("[catalogo-publico] no se pudieron cargar los relacionados:", err);
    cacheLife("degradado");
    return null;
  }
}

export interface Relacionados {
  /** Nombre de la categoría (para el link "Ver todo en …"). */
  categoria: string;
  productos: Product[];
}

/**
 * "Productos similares" en la ficha: los de la MISMA categoría que el producto,
 * sin el que se está viendo ni los agotados.
 *
 * Con categoría asignada en el admin, es esa exacta (sin subcategorías): en un
 * velador a batería, más veladores a batería. Sin ella, la categoría de Alegra
 * como antes. La caché es por categoría (no por producto): todas las fichas de
 * un rubro comparten la misma entrada. Si la base falla, vacío y la sección no
 * se dibuja.
 */
export async function relacionadosProducto(args: {
  categoriaPropiaId?: string;
  categoria?: string;
  excluirId: string;
  cantidad: number;
  soloVisibles: boolean;
  disp?: ContextoDisponibilidad;
  /** Medio destacado de las cards (argumento: parte de la clave de la caché). */
  destacado?: MedioPrecio | null;
  /** Cuotas sin interés de las cards (flag `cuotas-cobro`). */
  cuotas?: MedioCuotas[] | null;
}): Promise<Relacionados | null> {
  const recortar = (productos: Product[]) =>
    productos.filter((p) => p.id !== args.excluirId && p.stock !== "out").slice(0, args.cantidad);

  if (args.categoriaPropiaId) {
    const { categoriaPropiaId, soloVisibles, disp } = args;
    const destacado = args.destacado ?? null;
    const cuotas = args.cuotas ?? null;
    const exacta = await conRespaldoSinCache(
      "categoria-exacta",
      () => categoriaExacta(categoriaPropiaId, soloVisibles, disp, destacado, cuotas),
      () =>
        getCategoriaExacta({
          categoriaId: categoriaPropiaId,
          limit: TOPE_CATEGORIA_EXACTA,
          soloVisibles,
          disp,
          ...conMedios({ destacado, cuotas }),
        }).catch(() => null),
    );
    if (exacta) return { categoria: exacta.nombre, productos: recortar(exacta.productos) };
  }
  if (!args.categoria) return null;
  const { categoria, soloVisibles, disp } = args;
  const destacado = args.destacado ?? null;
  const cuotas = args.cuotas ?? null;
  const productos = await conRespaldoSinCache(
    "categoria-relacionados",
    () => primeraPaginaCategoria(categoria, soloVisibles, disp, destacado, cuotas),
    () =>
      getPaginaCatalogo({ filtros: { categorias: [categoria] }, pagina: 1, soloVisibles, disp, ...conMedios({ destacado, cuotas }) })
        .then((r) => r.productos)
        .catch(() => []),
  );
  return { categoria: args.categoria, productos: recortar(productos) };
}

/**
 * Ids de los productos publicados, para el sitemap. Si la base falla, vacío
 * (el sitemap sale con las páginas fijas) y guardado sólo con el perfil
 * `degradado`.
 */
export function idsProductosPublicos(soloVisibles: boolean): Promise<string[]> {
  return conRespaldoSinCache(
    "ids-productos",
    () => idsProductosCacheados(soloVisibles),
    () =>
      getCatalogo({ soloVisibles })
        .then((ps) => ps.map((p) => p.id))
        .catch(() => []),
  );
}

async function idsProductosCacheados(soloVisibles: boolean): Promise<string[]> {
  "use cache: remote";
  cacheTag(TAG_CATALOGO);
  console.info("[cache] ids-productos miss");
  try {
    const productos = await getCatalogo({ soloVisibles });
    cacheLife("catalogo");
    return productos.map((p) => p.id);
  } catch (err) {
    console.error("[catalogo-publico] no se pudieron cargar los productos del sitemap:", err);
    cacheLife("degradado");
    return [];
  }
}
