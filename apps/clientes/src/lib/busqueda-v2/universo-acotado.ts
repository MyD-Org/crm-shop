/**
 * ¿Tiene la consulta un UNIVERSO acotado? Decide la semántica de una medida DURA (ids dinámicos
 * `clave:valor`, ver catalogo-atributos-sql.ts):
 * - con universo (categoría dura o términos fuertes que recuperan): "sin contradicción", el
 *   producto sin el dato pasa y queda debajo de los que sí lo tienen;
 * - sin universo ("20a", "bipolar 20a", `?atr=corriente_a:20` a mano): "positivo", solo el que
 *   cumple. "Sin contradicción" sin universo devolvería el catálogo entero.
 *
 * Módulo puro. UN solo criterio: lo usan catalog.ts (para derivar el modo del filtro SQL) y,
 * más adelante, `aplicarMedidas` (para decidir si una medida puede ser dura), de modo que lo que
 * se decide al armar el plan y lo que filtra la página no se contradigan.
 */
import { terminosQueRecuperan } from "./recuperar";
import type { CriterioPlan } from "./piezas";

export interface FiltrosUniverso {
  /** Categorías duras (las de la URL). */
  categorias?: readonly string[];
  /** Texto de la búsqueda clásica (sin plan). */
  busqueda?: string;
  /** Búsqueda v2: el plan recupera con sus términos; el texto crudo ya no filtra. */
  planBusqueda?: CriterioPlan;
}

export function universoAcotado(f: FiltrosUniverso): boolean {
  if (f.categorias?.length) return true;
  if (f.planBusqueda) return terminosQueRecuperan(f.planBusqueda).length > 0;
  return Boolean(f.busqueda?.trim());
}
