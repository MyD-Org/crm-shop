/**
 * Tipos de la búsqueda inteligente del catálogo (spec catálogo asistido,
 * platform 2026-09-29). Módulo de tipos puro: lo importan también
 * componentes cliente (la franja), así que no arrastra nada de servidor.
 */

/** Filtros que salen de interpretar una búsqueda. Categorías por NOMBRE (lo que viaja en `?categoria=`). */
export interface FiltrosInterpretados {
  categorias: string[];
  /** Ids del diccionario de atributos (catalogo-atributos.ts). */
  atributos: string[];
}

export interface Interpretacion {
  /** Lo que escribió el usuario, tal cual. */
  consulta: string;
  /**
   * Lo que se aplica (determinista, o Jev con confianza ≥ 0,9). `q` es el
   * texto residual: los tokens con dígitos que ningún atributo absorbió
   * ("50w"); ausente = se quita la búsqueda.
   */
  aplicar: FiltrosInterpretados & { q?: string };
  /** Lo que se sugiere como chip (Jev con confianza entre 0,7 y 0,9). */
  sugerir: FiltrosInterpretados;
  fuente: "cache" | "deterministico" | "jev";
}

/** Categoría propia activa del tenant (misma forma que el árbol de catalog.ts). */
export interface NodoArbol {
  id: string;
  parentId: string | null;
  nombre: string;
  orden: number;
}

/** ¿La interpretación propone algo para aplicar? */
export function hayQueAplicar(i: Pick<Interpretacion, "aplicar">): boolean {
  return i.aplicar.categorias.length > 0 || i.aplicar.atributos.length > 0;
}

/** ¿La interpretación propone algo (aplicar o sugerir)? */
export function hayAlgo(i: Pick<Interpretacion, "aplicar" | "sugerir">): boolean {
  return hayQueAplicar(i) || i.sugerir.categorias.length > 0 || i.sugerir.atributos.length > 0;
}
