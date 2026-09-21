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

/**
 * Criterios de orden que ofrece el catálogo. Viven ACÁ y no en `catalog.ts`
 * porque el cliente los necesita: importarlos del módulo de catálogo le
 * arrastraría el driver de Postgres al bundle del browser.
 */
export const ORDENES = ["ventas", "precio-asc", "precio-desc", "nombre"] as const;
export type OrdenCatalogo = (typeof ORDENES)[number];

/** Estado completo del catálogo tal como lo codifica la URL. */
export interface EstadoCatalogo {
  /** Texto buscado (`?q=`). */
  query?: string;
  categorias: string[];
  marcas: string[];
  orden: OrdenCatalogo;
  /** 1-based. */
  pagina: number;
}

/** Lo que Next entrega en `searchParams`: un valor, varios, o nada. */
export type ParamCrudo = string | string[] | undefined;

/** Normaliza un parámetro repetible a lista, sin vacíos ni duplicados. */
export function comoLista(v: ParamCrudo): string[] {
  const vs = v == null ? [] : Array.isArray(v) ? v : [v];
  return [...new Set(vs.map((s) => s.trim()).filter(Boolean))];
}

/** Página 1-based leída de la URL. Basura o menor a 1 ⇒ 1. */
export function comoPagina(v: ParamCrudo): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

/** Valida un orden que viene de la URL. Cualquier cosa rara cae al default. */
export function comoOrden(v: ParamCrudo): OrdenCatalogo {
  const s = Array.isArray(v) ? v[0] : v;
  return (ORDENES as readonly string[]).includes(s ?? "")
    ? (s as OrdenCatalogo)
    : "ventas";
}

/** Lee el estado del catálogo desde los `searchParams` de la page. */
export function leerEstado(params: {
  q?: ParamCrudo;
  categoria?: ParamCrudo;
  marca?: ParamCrudo;
  orden?: ParamCrudo;
  pagina?: ParamCrudo;
}): EstadoCatalogo {
  const q = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim();
  return {
    query: q || undefined,
    categorias: comoLista(params.categoria),
    marcas: comoLista(params.marca),
    orden: comoOrden(params.orden),
    pagina: comoPagina(params.pagina),
  };
}

/**
 * URL del catálogo para un estado dado. Omite lo que está en su default para
 * que `/catalogo` siga siendo `/catalogo` y no `/catalogo?orden=ventas&pagina=1`.
 */
export function hrefCatalogo(estado: EstadoCatalogo): string {
  const sp = new URLSearchParams();
  if (estado.query) sp.set("q", estado.query);
  for (const c of estado.categorias) sp.append("categoria", c);
  for (const m of estado.marcas) sp.append("marca", m);
  if (estado.orden !== "ventas") sp.set("orden", estado.orden);
  if (estado.pagina > 1) sp.set("pagina", String(estado.pagina));
  const qs = sp.toString();
  return qs ? `/catalogo?${qs}` : "/catalogo";
}

/**
 * URL con parte del estado cambiado. Todo cambio que no sea de página vuelve a
 * la 1: si se tilda una marca estando en la página 7, la página 7 del nuevo
 * resultado puede no existir.
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
 * Números de página a mostrar, con `null` donde va una elipsis. Siempre incluye
 * la primera, la última y una ventana de tres alrededor de la actual, para que
 * la barra no crezca a 118 números cuando el catálogo tiene 2800 productos.
 */
export function paginasVisibles(actual: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const ventana = new Set<number>([1, total, actual]);
  // La ventana se corre hacia adentro en los extremos, para no dejar un hueco
  // de una sola página entre ella y la primera/última.
  const desde = Math.min(Math.max(actual - 1, 2), total - 3);
  for (let i = desde; i < desde + 3; i++) ventana.add(i);

  const nums = [...ventana].sort((a, b) => a - b);
  const salida: (number | null)[] = [];
  for (const [i, n] of nums.entries()) {
    if (i > 0 && n - nums[i - 1] > 1) salida.push(null);
    salida.push(n);
  }
  return salida;
}
