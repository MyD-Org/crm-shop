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
import type { FiltrosCatalogo } from "@/lib/catalog";

/**
 * Criterios de orden que ofrece el catálogo. Viven ACÁ y no en `catalog.ts`
 * porque el cliente los necesita: importarlos del módulo de catálogo le
 * arrastraría el driver de Postgres al bundle del browser.
 *
 * "Más vendidos" (`ventas`) ya no se ofrece: nunca tuvo un dato de ventas
 * detrás, ordenaba por nombre. Los links viejos con `orden=ventas` siguen
 * resolviendo (ver `comoOrden`).
 */
export const ORDENES = ["nombre", "precio-asc", "precio-desc"] as const;
export type OrdenCatalogo = (typeof ORDENES)[number];
export const ORDEN_DEFAULT: OrdenCatalogo = "nombre";

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
   * Sólo productos con disponibilidad. Default `true` (sin parámetro);
   * `?stock=todos` lo apaga. Ver `SOLO_STOCK_DEFAULT`.
   */
  soloStock: boolean;
  /** `?vista=lista`; cualquier otra cosa es grilla. */
  vista: VistaCatalogo;
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
 * Valida un orden que viene de la URL. Cualquier cosa rara cae al default;
 * `ventas` (links viejos) también, porque hoy ES el default.
 */
export function comoOrden(v: ParamCrudo): OrdenCatalogo {
  const s = primero(v);
  if (s === ORDEN_ALIAS_VIEJO) return ORDEN_DEFAULT;
  return (ORDENES as readonly string[]).includes(s ?? "")
    ? (s as OrdenCatalogo)
    : ORDEN_DEFAULT;
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

/** `vista=lista` exactamente; cualquier otra cosa es la grilla. */
function comoVista(v: ParamCrudo): VistaCatalogo {
  return primero(v) === "lista" ? "lista" : VISTA_DEFAULT;
}

/** Lee el estado del catálogo desde los `searchParams` de la page. */
export function leerEstado(params: {
  q?: ParamCrudo;
  categoria?: ParamCrudo;
  marca?: ParamCrudo;
  orden?: ParamCrudo;
  pagina?: ParamCrudo;
  precio_min?: ParamCrudo;
  precio_max?: ParamCrudo;
  stock?: ParamCrudo;
  vista?: ParamCrudo;
}): EstadoCatalogo {
  const q = primero(params.q)?.trim();
  let precioMin = comoPrecio(params.precio_min);
  let precioMax = comoPrecio(params.precio_max);
  // Invertidos se intercambian: quien escribió min=9000&max=100 quiso un
  // rango, no un conjunto vacío.
  if (precioMin != null && precioMax != null && precioMin > precioMax) {
    [precioMin, precioMax] = [precioMax, precioMin];
  }
  return {
    query: q || undefined,
    categorias: comoLista(params.categoria),
    marcas: comoLista(params.marca),
    orden: comoOrden(params.orden),
    pagina: comoPagina(params.pagina),
    precioMin,
    precioMax,
    soloStock: comoSoloStock(params.stock),
    vista: comoVista(params.vista),
  };
}

/**
 * URL del catálogo para un estado dado. Omite lo que está en su default para
 * que `/catalogo` siga siendo `/catalogo` y no `/catalogo?orden=nombre&pagina=1`.
 *
 * El orden de los parámetros es fijo (`q, categoria*, marca*, precio_min,
 * precio_max, stock, orden, vista, pagina`): dos estados iguales dan la misma
 * URL, que es lo que necesitan el canonical y los tests.
 */
export function hrefCatalogo(estado: EstadoCatalogo): string {
  const sp = new URLSearchParams();
  if (estado.query) sp.set("q", estado.query);
  for (const c of estado.categorias) sp.append("categoria", c);
  for (const m of estado.marcas) sp.append("marca", m);
  if (estado.precioMin != null) sp.set("precio_min", String(estado.precioMin));
  if (estado.precioMax != null) sp.set("precio_max", String(estado.precioMax));
  if (estado.soloStock !== SOLO_STOCK_DEFAULT) sp.set("stock", STOCK_INCLUYE_SIN_STOCK);
  if (estado.orden !== ORDEN_DEFAULT) sp.set("orden", estado.orden);
  if (estado.vista !== VISTA_DEFAULT) sp.set("vista", estado.vista);
  if (estado.pagina > 1) sp.set("pagina", String(estado.pagina));
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
  return hrefCatalogo({
    ...estado,
    pagina: cambios.pagina ?? 1,
    ...cambios,
  });
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
    orden: ORDEN_DEFAULT,
    pagina: estado.pagina,
    soloStock: SOLO_STOCK_DEFAULT,
    vista: VISTA_DEFAULT,
  });
}

/**
 * Filtros que la page le pasa a la consulta (`getPaginaCatalogo` /
 * `getFacetas`). Vive acá, puro, para que el default de "Solo con stock"
 * llegue al SQL con test: sin parámetros, `soloStock` es `true`.
 */
export function filtrosDeEstado(estado: EstadoCatalogo): FiltrosCatalogo {
  return {
    busqueda: estado.query,
    categorias: estado.categorias,
    marcas: estado.marcas,
    precioMin: estado.precioMin,
    precioMax: estado.precioMax,
    soloStock: estado.soloStock,
  };
}
