/**
 * Estado del catálogo ⇄ query string.
 *
 * Desde que el catálogo se pagina en el servidor, los filtros, el orden y la
 * página viven en la URL: son lo que la page lee para armar la query, y lo que
 * hace que un resultado filtrado se pueda compartir o volver atrás con el
 * botón del browser.
 *
 * Módulo puro (sin DB ni React): lo usan la page en el servidor y el
 * `CatalogoClient` en el browser, así que los dos lados leen y escriben la URL
 * con exactamente las mismas reglas.
 */
// Sólo el tipo: `import type` se borra al compilar y no arrastra el driver
// de Postgres al bundle del browser.
import type { FiltrosSinTexto } from "@/lib/catalog";
import { atributosValidos } from "@/lib/catalogo-atributos";
import { leerCar } from "@/lib/catalogo-car";

/**
 * Criterios de orden que ofrece el catálogo. Viven ACÁ y no en `catalog.ts`
 * porque el cliente los necesita: importarlos del módulo de catálogo le
 * arrastraría el driver de Postgres al bundle del browser.
 *
 * "Más vendidos" (`ventas`) ya no se ofrece: nunca tuvo un dato de ventas
 * detrás, ordenaba por nombre. Los links viejos con `orden=ventas` siguen
 * resolviendo (ver `comoOrden`).
 *
 * `destacados` es el orden automático sin búsqueda (con stock, con foto, no
 * accesorios, subcategorías intercaladas; ver `ordenDestacadosSql` en catalog.ts).
 * `nombre` sigue disponible a mano y en los links viejos que lo traen explícito.
 */
export const ORDENES = ["relevancia", "destacados", "nombre", "precio-asc", "precio-desc"] as const;
export type OrdenCatalogo = (typeof ORDENES)[number];
/** Default SIN búsqueda. Con búsqueda es `relevancia` (ver `ordenPorDefecto`). */
export const ORDEN_DEFAULT: OrdenCatalogo = "destacados";

/**
 * El default depende de si hay texto buscado: con búsqueda, lo más parecido
 * primero; sin búsqueda, destacados. "Relevancia" sin búsqueda no significa
 * nada, y "Destacados" con búsqueda taparía la relevancia: cada uno es sólo
 * de su caso.
 */
export function ordenPorDefecto(query: string | undefined): OrdenCatalogo {
  return query ? "relevancia" : ORDEN_DEFAULT;
}

/** Orden que aceptan las URLs viejas y que hoy equivale al default. */
const ORDEN_ALIAS_VIEJO = "ventas";

/**
 * "Solo con stock" viene PRENDIDO por defecto (decisión de producto): sin el
 * parámetro, el catálogo muestra sólo lo que tiene disponibilidad. Apagarlo
 * es lo que viaja en la URL, con un valor explícito (`?stock=todos`).
 *
 * Los links viejos con `?stock=1` (cuando el filtro era opt-in) siguen
 * resolviendo: cualquier valor distinto de `todos` es el default, así que
 * se normalizan a la URL sin el parámetro.
 */
export const SOLO_STOCK_DEFAULT = true;

/** Valor de `?stock=` que apaga "Solo con stock" (incluye productos sin stock). */
export const STOCK_INCLUYE_SIN_STOCK = "todos";

/** Cómo se muestra la página de resultados. */
export const VISTAS = ["grilla", "lista"] as const;
export type VistaCatalogo = (typeof VISTAS)[number];
export const VISTA_DEFAULT: VistaCatalogo = "grilla";

/** Estado completo del catálogo tal como lo codifica la URL. */
export interface EstadoCatalogo {
  /** Texto buscado (`?q=`). */
  query?: string;
  categorias: string[];
  marcas: string[];
  /**
   * Atributos del diccionario (`?atr=`, repetible; ver catalogo-atributos.ts).
   * Los ids desconocidos se descartan al leer; quedan en el orden del
   * diccionario.
   */
  atributos: string[];
  /**
   * Características por tipo de producto (`?car=`, flag `catalogo-facetas-por-tipo`; ver
   * catalogo-car.ts): ids `clave:valor` / `clave:min-max`, ya validados y en el orden de emisión.
   * Son específicas del tipo de producto: cambiar la categoría o la búsqueda las descarta.
   */
  caracteristicas: string[];
  orden: OrdenCatalogo;
  /** 1-based. */
  pagina: number;
  /**
   * Extremos del rango de precio (`?precio_min=&precio_max=`), enteros >= 0
   * en la moneda exhibida (con IVA). Ausente = sin tope de ese lado.
   */
  precioMin?: number;
  precioMax?: number;
  /**
   * Extremos de la potencia en watts (`?potencia_min=&potencia_max=`, flag
   * `busqueda-ia`): enteros >= 0, sólo sobre productos con potencia
   * estructurada (`catalog_atributos.potencia_w`). Ausente = sin tope.
   */
  potenciaMin?: number;
  potenciaMax?: number;
  /**
   * Sólo productos con disponibilidad. Default `true` (sin parámetro);
   * `?stock=todos` lo apaga. Ver `SOLO_STOCK_DEFAULT`.
   */
  soloStock: boolean;
  /**
   * Slug del local donde tiene que haber stock (`?retiro=igz`): "Con stock en Puerto Iguazú".
   * Implica `soloStock`. La page lo valida contra los locales activos que aceptan retiro; uno
   * desconocido se descarta. Ausente = stock en cualquier local.
   */
  retiroEn?: string;
  /** `?vista=lista`; cualquier otra cosa es grilla. */
  vista: VistaCatalogo;
  /**
   * Búsqueda inteligente (`?ia=`, flag `busqueda-ia`):
   * - la consulta original, cuando el estado vino de interpretarla (la franja
   *   muestra "Entendimos:" y ofrece verla tal cual);
   * - `"0"` (`IA_DESACTIVADA`): la búsqueda se muestra tal cual, sin interpretar.
   * Con cualquier valor la page NO vuelve a interpretar (evita el bucle de
   * redirecciones).
   */
  ia?: string;
}

/** Valor de `?ia=` que pide ver la búsqueda tal cual, sin interpretarla. */
export const IA_DESACTIVADA = "0";

/**
 * Valor de `?ia=` de una búsqueda entendida por la búsqueda v2 (`/buscar`): la consulta es el
 * `q` de la URL y la página lee su plan (lo blando) de la caché. Los links viejos de la fase 1
 * (`ia=<consulta>`) siguen resolviendo: muestran los filtros de la URL, sin plan.
 */
export const IA_PLAN = "1";

/** Tope de largo de `?ia=` (igual que la consulta que se interpreta). */
const LARGO_MAX_IA = 120;
/**
 * Tope de largo de `?q=`: holgado para cualquier búsqueda real (la búsqueda
 * usa hasta 8 términos), pero una URL con kilobytes de texto no llega al SQL.
 */
export const LARGO_MAX_Q = 200;

/**
 * La consulta original si el estado vino de interpretarla; si no, `undefined`. Con `ia=1`
 * (búsqueda v2) es el `q`; con un `ia=<consulta>` viejo (fase 1), ese texto.
 */
export function consultaInterpretada(estado: Pick<EstadoCatalogo, "ia" | "query">): string | undefined {
  if (estado.ia === IA_PLAN) return estado.query;
  return estado.ia && estado.ia !== IA_DESACTIVADA ? estado.ia : undefined;
}

/**
 * Rango real de precios del conjunto filtrado (enteros, `floor`/`ceil`). Lo
 * calcula `getFacetas`; acá vive el tipo porque el cliente lo necesita.
 */
export interface RangoPrecio {
  min: number;
  max: number;
}

/** Lo que Next entrega en `searchParams`: un valor, varios, o nada. */
export type ParamCrudo = string | string[] | undefined;

/** Primer valor de un parámetro que puede venir repetido. */
const primero = (v: ParamCrudo): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/** Normaliza un parámetro repetible a lista, sin vacíos ni duplicados. */
export function comoLista(v: ParamCrudo): string[] {
  const vs = v == null ? [] : Array.isArray(v) ? v : [v];
  return [...new Set(vs.map((s) => s.trim()).filter(Boolean))];
}

/** Página 1-based leída de la URL. Basura o menor a 1 ⇒ 1. */
export function comoPagina(v: ParamCrudo): number {
  const n = Number(primero(v));
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

/**
 * Valida un orden que viene de la URL. Cualquier cosa rara cae al default
 * (que depende de si hay búsqueda, ver `ordenPorDefecto`); `ventas` (links
 * viejos) también. `relevancia` sin búsqueda cae a destacados y `destacados`
 * con búsqueda, a relevancia.
 */
export function comoOrden(v: ParamCrudo, query?: string): OrdenCatalogo {
  const s = primero(v);
  const porDefecto = ordenPorDefecto(query);
  if (s === ORDEN_ALIAS_VIEJO) return porDefecto;
  if (s === "relevancia" && !query) return ORDEN_DEFAULT;
  if (s === "destacados" && query) return "relevancia";
  return (ORDENES as readonly string[]).includes(s ?? "")
    ? (s as OrdenCatalogo)
    : porDefecto;
}

/**
 * Precio leído de la URL: entero no negativo. Decimales se truncan; vacío,
 * negativo o no numérico ⇒ sin precio (nunca rompe).
 */
export function comoPrecio(v: ParamCrudo): number | undefined {
  const s = primero(v)?.trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : undefined;
}

/**
 * `stock=todos` exactamente apaga el filtro; cualquier otra cosa (incluido el
 * `stock=1` de los links viejos) es el default.
 */
function comoSoloStock(v: ParamCrudo): boolean {
  return primero(v) === STOCK_INCLUYE_SIN_STOCK ? false : SOLO_STOCK_DEFAULT;
}

/** Slug de local: minúsculas, dígitos y guiones. Cualquier otra cosa se ignora. */
function comoRetiro(v: ParamCrudo): string | undefined {
  const s = primero(v)?.trim().toLowerCase();
  return s && /^[a-z0-9][a-z0-9-]{0,39}$/.test(s) ? s : undefined;
}

/** `vista=lista` exactamente; cualquier otra cosa es la grilla. */
function comoVista(v: ParamCrudo): VistaCatalogo {
  return primero(v) === "lista" ? "lista" : VISTA_DEFAULT;
}

/** Lee el estado del catálogo desde los `searchParams` de la page. */
export function leerEstado(params: {
  q?: ParamCrudo;
  categoria?: ParamCrudo;
  marca?: ParamCrudo;
  atr?: ParamCrudo;
  car?: ParamCrudo;
  orden?: ParamCrudo;
  pagina?: ParamCrudo;
  precio_min?: ParamCrudo;
  precio_max?: ParamCrudo;
  potencia_min?: ParamCrudo;
  potencia_max?: ParamCrudo;
  stock?: ParamCrudo;
  retiro?: ParamCrudo;
  vista?: ParamCrudo;
  ia?: ParamCrudo;
}): EstadoCatalogo {
  const q = primero(params.q)?.trim().slice(0, LARGO_MAX_Q).trim();
  let precioMin = comoPrecio(params.precio_min);
  let precioMax = comoPrecio(params.precio_max);
  // Invertidos se intercambian: quien escribió min=9000&max=100 quiso un
  // rango, no un conjunto vacío.
  if (precioMin != null && precioMax != null && precioMin > precioMax) {
    [precioMin, precioMax] = [precioMax, precioMin];
  }
  // Potencia: mismas reglas que el precio (entero >= 0; invertidos se intercambian).
  let potenciaMin = comoPrecio(params.potencia_min);
  let potenciaMax = comoPrecio(params.potencia_max);
  if (potenciaMin != null && potenciaMax != null && potenciaMin > potenciaMax) {
    [potenciaMin, potenciaMax] = [potenciaMax, potenciaMin];
  }
  const ia = primero(params.ia)?.trim().slice(0, LARGO_MAX_IA);
  return {
    query: q || undefined,
    categorias: comoLista(params.categoria),
    marcas: comoLista(params.marca),
    atributos: atributosValidos(comoLista(params.atr)),
    caracteristicas: leerCar(comoLista(params.car)),
    orden: comoOrden(params.orden, q || undefined),
    pagina: comoPagina(params.pagina),
    precioMin,
    precioMax,
    ...(potenciaMin != null ? { potenciaMin } : {}),
    ...(potenciaMax != null ? { potenciaMax } : {}),
    soloStock: comoSoloStock(params.stock),
    retiroEn: comoRetiro(params.retiro),
    vista: comoVista(params.vista),
    ...(ia ? { ia } : {}),
  };
}

/**
 * Lee el estado desde la query string del browser (`useSearchParams`), con
 * las mismas reglas que `leerEstado` usa en la page.
 */
export function estadoDeBusqueda(sp: URLSearchParams): EstadoCatalogo {
  const param = (k: string) => sp.getAll(k);
  return leerEstado({
    q: param("q"),
    categoria: param("categoria"),
    marca: param("marca"),
    atr: param("atr"),
    car: param("car"),
    orden: param("orden"),
    pagina: param("pagina"),
    precio_min: param("precio_min"),
    precio_max: param("precio_max"),
    potencia_min: param("potencia_min"),
    potencia_max: param("potencia_max"),
    stock: param("stock"),
    retiro: param("retiro"),
    vista: param("vista"),
    ia: param("ia"),
  });
}

/**
 * El estado tal como lo ve el catálogo con el flag `busqueda-ia` APAGADO:
 * sin atributos, potencia ni `ia` (el catálogo de siempre no los conoce). Así
 * una URL con `?atr=`, `?potencia_min=` o `?ia=` da, con el flag apagado, lo
 * mismo que antes del cambio.
 */
export function sinBusquedaIa(estado: EstadoCatalogo): EstadoCatalogo {
  const { ia: _ia, potenciaMin: _pmin, potenciaMax: _pmax, ...resto } = estado;
  void _ia;
  void _pmin;
  void _pmax;
  return { ...resto, atributos: [] };
}

/**
 * El estado sin las características por tipo: con el flag `catalogo-facetas-por-tipo` apagado (o la
 * tabla de atributos ilegible) `?car=` se ignora y el catálogo queda como siempre.
 */
export function sinCar(estado: EstadoCatalogo): EstadoCatalogo {
  return { ...estado, caracteristicas: [] };
}

/** Misma selección, sin importar el orden. */
const mismoConjunto = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * La URL que muestra el router tiene otras categorías o marcas que las que
 * renderizó el servidor.
 *
 * Pasa por un bug de Next (16.2.9, `createSegmentFromRouteTree` en
 * ppr-navigations.js): la clave del segmento de la página sale de
 * `Object.fromEntries(new URLSearchParams(search))`, que de un parámetro
 * repetido se queda sólo con el ÚLTIMO valor. `marca=KING&marca=AKAI` y
 * `marca=AKAI` dan la misma clave, así que al destildar KING Next cambia la
 * URL pero reusa la página vieja sin pedir nada al servidor. Sólo lo sufren
 * los parámetros repetibles; el resto no se compara (la página, por ejemplo,
 * llega recortada a la última que existe y no es un desfase).
 */
export function filtrosDesfasados(
  estado: EstadoCatalogo,
  sp: URLSearchParams,
  conBusquedaIa = true,
  conFacetasPorTipo = false,
): boolean {
  // Sin el flag los atributos de la URL se ignoran: compararlos pediría la
  // página una y otra vez. Lo mismo con `car` sin el flag de facetas por tipo.
  const leido = conBusquedaIa ? estadoDeBusqueda(sp) : sinBusquedaIa(estadoDeBusqueda(sp));
  const url = conFacetasPorTipo ? leido : sinCar(leido);
  return (
    !mismoConjunto(estado.categorias, url.categorias) ||
    !mismoConjunto(estado.marcas, url.marcas) ||
    !mismoConjunto(estado.atributos, url.atributos) ||
    !mismoConjunto(estado.caracteristicas, url.caracteristicas)
  );
}

/**
 * URL del catálogo para un estado dado. Omite lo que está en su default para
 * que `/catalogo` siga siendo `/catalogo` y no `/catalogo?orden=destacados&pagina=1`.
 *
 * El orden de los parámetros es fijo (`q, categoria*, marca*, atr*, car*,
 * precio_min, precio_max, potencia_min, potencia_max, stock, retiro, orden, vista,
 * pagina, ia`): dos estados
 * iguales dan la misma URL, que es lo que necesitan el canonical y los tests.
 */
export function hrefCatalogo(estado: EstadoCatalogo): string {
  const sp = new URLSearchParams();
  if (estado.query) sp.set("q", estado.query);
  for (const c of estado.categorias) sp.append("categoria", c);
  for (const m of estado.marcas) sp.append("marca", m);
  for (const a of atributosValidos(estado.atributos)) sp.append("atr", a);
  for (const c of leerCar(estado.caracteristicas)) sp.append("car", c);
  if (estado.precioMin != null) sp.set("precio_min", String(estado.precioMin));
  if (estado.precioMax != null) sp.set("precio_max", String(estado.precioMax));
  if (estado.potenciaMin != null) sp.set("potencia_min", String(estado.potenciaMin));
  if (estado.potenciaMax != null) sp.set("potencia_max", String(estado.potenciaMax));
  if (estado.soloStock !== SOLO_STOCK_DEFAULT) sp.set("stock", STOCK_INCLUYE_SIN_STOCK);
  if (estado.retiroEn) sp.set("retiro", estado.retiroEn);
  if (estado.orden !== ordenPorDefecto(estado.query)) sp.set("orden", estado.orden);
  if (estado.vista !== VISTA_DEFAULT) sp.set("vista", estado.vista);
  if (estado.pagina > 1) sp.set("pagina", String(estado.pagina));
  if (estado.ia) sp.set("ia", estado.ia);
  const qs = sp.toString();
  return qs ? `/catalogo?${qs}` : "/catalogo";
}

/**
 * URL con parte del estado cambiado. Todo cambio que no sea de página vuelve a
 * la 1: si se tilda una marca estando en la página 7, la página 7 del nuevo
 * resultado puede no existir.
 *
 * Quien sólo cambia la vista (grilla/lista) pasa `pagina: estado.pagina`
 * explícita: el conjunto de resultados no cambia, la página tampoco debería.
 *
 * Un cambio con `undefined` (`{ precioMin: undefined }`) BORRA el parámetro:
 * el spread pisa el valor del estado.
 */
export function hrefCon(
  estado: EstadoCatalogo,
  cambios: Partial<EstadoCatalogo>
): string {
  return hrefCatalogo(estadoConCambios(estado, cambios));
}

/**
 * Aplica un cambio parcial sobre un estado y devuelve el estado resultante
 * (misma regla que `hrefCon`: todo cambio que no sea de página vuelve a la
 * 1). La usan `hrefCon` y, en el cliente, quien necesite encadenar varios
 * cambios sin esperar a que React vuelva a renderizar entre uno y otro (ver
 * `CatalogoClient`): ahí no alcanza con leer el estado del último render,
 * porque dos cambios seguidos pueden llegar antes de que ese render pase.
 */
export function estadoConCambios(
  estado: EstadoCatalogo,
  cambios: Partial<EstadoCatalogo>
): EstadoCatalogo {
  const nuevo = { ...estado, pagina: cambios.pagina ?? 1, ...cambios };
  // Otra búsqueda ya no es la que se interpretó (ni la que se pidió ver tal
  // cual): `ia` sólo sigue si quien cambia la búsqueda lo pasa explícito.
  if ("query" in cambios && cambios.query !== estado.query && !("ia" in cambios)) delete nuevo.ia;
  // Las características por tipo son de ESTE tipo de producto: otra categoría o otra búsqueda las
  // descarta (marca, precio y stock se conservan). Quien cambia el conjunto y trae sus propias
  // características (un link, un borrador) las pasa explícitas.
  const cambiaConjunto =
    ("categorias" in cambios && !mismoConjunto(cambios.categorias ?? [], estado.categorias)) ||
    ("query" in cambios && cambios.query !== estado.query);
  if (cambiaConjunto && !("caracteristicas" in cambios)) nuevo.caracteristicas = [];
  // Quitar la búsqueda deja sin sentido "Relevancia": vuelve a destacados. Y al revés: una
  // búsqueda nueva sobre "Destacados" pasa a relevancia (destacados no ordena búsquedas).
  if (nuevo.orden === "relevancia" && !nuevo.query) nuevo.orden = ORDEN_DEFAULT;
  if (nuevo.orden === "destacados" && nuevo.query) nuevo.orden = "relevancia";
  return nuevo;
}

/**
 * Valor que muestra el slider de precio: los extremos de la URL recortados al
 * rango real del conjunto filtrado, o el rango entero si la URL no trae nada.
 * Sin rango real (conjunto vacío) no hay nada que mostrar: `[0, 0]`.
 */
export function rangoEfectivo(
  estado: Pick<EstadoCatalogo, "precioMin" | "precioMax">,
  rango: RangoPrecio | null
): [number, number] {
  if (!rango) return [0, 0];
  const acotar = (n: number) => Math.min(Math.max(n, rango.min), rango.max);
  return [
    estado.precioMin != null ? acotar(estado.precioMin) : rango.min,
    estado.precioMax != null ? acotar(estado.precioMax) : rango.max,
  ];
}

/**
 * Cambios de estado para un valor comprometido en el slider. El extremo que
 * coincide con el límite real no viaja en la URL: `[120, 80000]` sobre un
 * rango `[120, 80000]` es "sin filtro de precio", no dos parámetros.
 */
export function cambiosDeRango(
  valor: [number, number],
  rango: RangoPrecio | null
): Pick<EstadoCatalogo, "precioMin" | "precioMax"> {
  if (!rango) return { precioMin: undefined, precioMax: undefined };
  const [min, max] = valor;
  return {
    precioMin: min > rango.min ? min : undefined,
    precioMax: max < rango.max ? max : undefined,
  };
}

/**
 * URL canónica de un estado: la categoría (sólo la primera) y la página. Todo
 * lo demás (búsqueda, marcas, precio, stock, orden, vista) son variantes de
 * la misma página para los buscadores. La paginación vive en el DS
 * (`Pagination` / `paginationWindow`).
 */
export function hrefCanonico(estado: EstadoCatalogo): string {
  return hrefCatalogo({
    categorias: estado.categorias.slice(0, 1),
    marcas: [],
    atributos: [],
    caracteristicas: [],
    orden: ORDEN_DEFAULT,
    pagina: estado.pagina,
    soloStock: SOLO_STOCK_DEFAULT,
    vista: VISTA_DEFAULT,
  });
}

/**
 * Filtros que la page le pasa a la consulta (`getPaginaCatalogo` /
 * `getFacetas`), SIN texto: la consulta (`estado.query`) se la pasa la page al motor, que arma el
 * `texto` de cada etapa. Vive acá, puro, para que el default de "Solo con stock"
 * llegue al SQL con test: sin parámetros, `soloStock` es `true`.
 */
export function filtrosDeEstado(estado: EstadoCatalogo): FiltrosSinTexto {
  return {
    categorias: estado.categorias,
    marcas: estado.marcas,
    atributos: estado.atributos,
    precioMin: estado.precioMin,
    precioMax: estado.precioMax,
    potenciaMin: estado.potenciaMin,
    potenciaMax: estado.potenciaMax,
    // "Con stock en <local>" es un filtro de stock: sin stock no tiene sentido.
    soloStock: estado.soloStock || Boolean(estado.retiroEn),
  };
}

/** Potencia de la URL recortada al rango real (mismas reglas que `rangoEfectivo`). */
export function rangoEfectivoPotencia(
  estado: Pick<EstadoCatalogo, "potenciaMin" | "potenciaMax">,
  rango: RangoPrecio | null
): [number, number] {
  return rangoEfectivo({ precioMin: estado.potenciaMin, precioMax: estado.potenciaMax }, rango);
}

/**
 * Cambios de estado para un rango de potencia comprometido en el slider: un
 * extremo que coincide con el límite real no viaja (igual que el precio).
 */
export function cambiosDePotencia(
  valor: [number, number],
  rango: RangoPrecio | null
): Pick<EstadoCatalogo, "potenciaMin" | "potenciaMax"> {
  const { precioMin, precioMax } = cambiosDeRango(valor, rango);
  return { potenciaMin: precioMin, potenciaMax: precioMax };
}
