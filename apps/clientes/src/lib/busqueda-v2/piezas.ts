/**
 * Piezas SQL que Recuperar y Ordenar necesitan del catálogo. Las arma
 * catalog.ts (conoce las vistas, los joins y el stock por sucursal) y las
 * pasa: así estos módulos no importan catalog.ts (sin ciclo) y su SQL se
 * prueba con piezas falsas. Mismo patrón que `ContextoAtributos`.
 */
import type { SQL } from "drizzle-orm";
import { formasTermino } from "../catalogo-busqueda";
import type { PlanBusqueda } from "./plan";

export interface PiezasBusqueda {
  /** Todo el texto buscable, normalizado (minúsculas, sin tildes). */
  texto: SQL;
  /** Nombre exhibido, código y marca + categoría de Alegra, normalizados. */
  nombre: SQL;
  codigo: SQL;
  marcaCategoria: SQL;
  /** El producto está en alguna de estas categorías (por nombre, con su subárbol). */
  enCategorias: (nombres: string[]) => SQL;
  /** El producto cumple el atributo (dato estructurado o patrón), o `undefined` si el id no existe. */
  cumpleAtributo: (id: string) => SQL | undefined;
  /**
   * El producto tiene dato estructurado del atributo y es OTRO valor (la contradicción). Ordena, nunca filtra.
   * Opcional: sin ella (o `undefined` para el id) no hay orden estricto de medidas.
   */
  contradiceAtributo?: (id: string) => SQL | undefined;
  /** El producto tiene disponibilidad (según el contexto de sucursal). */
  conStock: SQL;
  /** Potencia estructurada (W) del producto, numeric o NULL. Opcional: sin ella, lo industrial se lee sólo del nombre. */
  potencia?: SQL;
}

/** Lo que del plan usan Recuperar y Ordenar (lo demás lo resuelve la URL). */
export type CriterioPlan = Pick<PlanBusqueda, "consulta" | "blandos"> & {
  /**
   * Todas las categorías que entendió el plan (duras y blandas), por nombre. Sólo desempata: a igual
   * puntaje, antes el producto que está en alguna. Sirve donde los duros no filtran (autocompletar).
   */
  categoriasDelPlan?: string[];
  /**
   * Categorías que el plan DEDUJO como duras (`plan.duros.categorias`). No son un filtro de la persona
   * (no viajan en la URL ni tienen chip): ordenan como blandas de `PESO_DEDUCIDO` y ACOTAN la
   * recuperación por OR de términos, que sin ellas trae cualquier producto que comparta una palabra
   * ("luz" en "ventilador de techo con luz"). Nunca dejan afuera a un producto que tiene TODAS las
   * palabras pedidas (o sus sinónimos), esté en la categoría que esté (`acotarPorDeducidas`).
   */
  deducidas?: string[];
};

const ESPECIALES_REGEX = /[.*+?^${}()|[\]\\]/g;

/**
 * Regex (ARE de Postgres, también válida en JS) de un término al COMIENZO de
 * una palabra, en cualquiera de sus formas (tal cual y en singular): "olor" no
 * encuentra "color" y "toma" no encuentra "automatismo", que con `LIKE
 * '%…%'` sí. Viaja como parámetro.
 */
export function patronTermino(termino: string): string {
  return `(^|[^a-z0-9])(${formasEscapadas(termino)})`;
}

/** El texto EMPIEZA con el término (alguna de sus formas). */
export function patronInicio(termino: string): string {
  return `^(${formasEscapadas(termino)})`;
}

/** Palabras de enlace que pueden ir entre dos términos de una frase ("lampara DE escritorio"). */
const ENLACES = "de|del|la|las|el|los|para|con|en|y|un|una";

/**
 * Los términos en ORDEN y juntos (con a lo sumo palabras de enlace entre ellos), cada uno al comienzo
 * de palabra: "lampara", "escritorio" encuentra "lampara de escritorio articulada" y "lampara para
 * escritorio", pero no "escritorio con lampara" ni "lampara led de escritorio". Con menos de dos
 * términos no es una frase: `null`.
 */
export function patronFrase(terminos: readonly string[]): string | null {
  if (terminos.length < 2) return null;
  const [primero, ...resto] = terminos;
  const union = `(?:[^a-z0-9]+(?:${ENLACES}))*[^a-z0-9]+`;
  // Un término que no es el último puede venir en plural ("lamparas de escritorio").
  const plural = "(?:e?s)?";
  return `(^|[^a-z0-9])(${formasEscapadas(primero)})${resto.map((t) => `${plural}${union}(${formasEscapadas(t)})`).join("")}`;
}

const formasEscapadas = (termino: string) =>
  formasTermino(termino)
    .map((f) => f.replace(ESPECIALES_REGEX, "\\$&"))
    .join("|");
