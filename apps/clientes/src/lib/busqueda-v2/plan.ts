/**
 * El contrato de la búsqueda v2 (spec platform 2026-10-01): `PlanBusqueda`, la
 * costura entre Entender, Recuperar, Ordenar y Presentar. Las iteraciones
 * futuras (embeddings, rerank, diccionario editable, popularidad) cambian cómo
 * se llena o cómo se usa, no su forma.
 *
 * Módulo puro de tipos y validación: lo importan también componentes cliente.
 */

export type Intencion = "codigo" | "producto" | "necesidad" | "pregunta";
export const INTENCIONES: readonly Intencion[] = ["codigo", "producto", "necesidad", "pregunta"];

export interface Ponderado {
  peso: number;
}

export interface PlanBusqueda {
  version: 1;
  /** Lo que escribió el usuario (recortado). */
  consulta: string;
  intencion: Intencion;
  /** Filtros visibles con ✕: categorías por NOMBRE (lo que viaja en `?categoria=`), atributos por id. */
  duros: { categorias: string[]; atributos: string[] };
  blandos: {
    categorias: ({ nombre: string } & Ponderado)[];
    atributos: ({ id: string } & Ponderado)[];
    /** Términos normalizados: los de la consulta y sus expansiones (sinónimos), con peso. */
    terminos: ({ texto: string } & Ponderado)[];
  };
  fuente: "deterministico" | "jev" | "cache";
}

/** Términos desde este peso RECUPERAN (entran al OR de candidatos); los de menos sólo ordenan. */
export const PESO_MINIMO_RECUPERAR = 0.6;

export function planVacio(consulta: string, intencion: Intencion = "producto"): PlanBusqueda {
  return {
    version: 1,
    consulta,
    intencion,
    duros: { categorias: [], atributos: [] },
    blandos: { categorias: [], atributos: [], terminos: [] },
    fuente: "deterministico",
  };
}

export function hayDuros(p: Pick<PlanBusqueda, "duros">): boolean {
  return p.duros.categorias.length > 0 || p.duros.atributos.length > 0;
}

export function hayBlandos(p: Pick<PlanBusqueda, "blandos">): boolean {
  return p.blandos.categorias.length > 0 || p.blandos.atributos.length > 0 || p.blandos.terminos.length > 0;
}

const texto = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
const peso = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const lista = (v: unknown) => (Array.isArray(v) ? v : []);

/**
 * Un plan guardado (caché en la base) → plan válido, o `null` si no es un
 * `PlanBusqueda` versión 1 (las filas de la fase 1 no tienen `version`: se
 * ignoran). Descarta en silencio los elementos mal formados: una fila rota no
 * rompe la búsqueda.
 */
export function comoPlan(v: unknown): PlanBusqueda | null {
  const o = (v ?? {}) as Record<string, unknown>;
  if (o.version !== 1 || !texto(o.consulta) || !INTENCIONES.includes(o.intencion as Intencion)) return null;
  const duros = (o.duros ?? {}) as Record<string, unknown>;
  const blandos = (o.blandos ?? {}) as Record<string, unknown>;
  const ponderados = <K extends string>(xs: unknown, clave: K) =>
    lista(xs)
      .map((x) => (x ?? {}) as Record<string, unknown>)
      .filter((x) => texto(x[clave]) && peso(x.peso))
      .map((x) => ({ [clave]: x[clave] as string, peso: x.peso as number })) as ({ [P in K]: string } & Ponderado)[];
  return {
    version: 1,
    consulta: o.consulta as string,
    intencion: o.intencion as Intencion,
    duros: { categorias: lista(duros.categorias).filter(texto), atributos: lista(duros.atributos).filter(texto) },
    blandos: {
      categorias: ponderados(blandos.categorias, "nombre"),
      atributos: ponderados(blandos.atributos, "id"),
      terminos: ponderados(blandos.terminos, "texto"),
    },
    fuente: o.fuente === "jev" ? "jev" : "deterministico",
  };
}
