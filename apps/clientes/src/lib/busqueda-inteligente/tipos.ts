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

/** Categoría propia activa del tenant (misma forma que el árbol de catalog.ts). */
export interface NodoArbol {
  id: string;
  parentId: string | null;
  nombre: string;
  orden: number;
}
