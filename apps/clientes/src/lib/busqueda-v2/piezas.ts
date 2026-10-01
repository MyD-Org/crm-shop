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
  /** El producto tiene disponibilidad (según el contexto de sucursal). */
  conStock: SQL;
}

/** Lo que del plan usan Recuperar y Ordenar (lo demás lo resuelve la URL). */
export type CriterioPlan = Pick<PlanBusqueda, "consulta" | "blandos">;

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

const formasEscapadas = (termino: string) =>
  formasTermino(termino)
    .map((f) => f.replace(ESPECIALES_REGEX, "\\$&"))
    .join("|");
