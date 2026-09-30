/**
 * La regla única para usar los atributos estructurados (`public.catalog_atributos`, fichas
 * estructuradas fase 2): flag `busqueda-ia` prendido Y tabla legible. La usan el catálogo, la
 * ficha del producto y las rutas del chat. Con el flag apagado ni se consulta la base.
 *
 * SOLO servidor.
 */
import { busquedaIaHabilitada } from "./busqueda-ia-flag";
import { atributosEstructuradosDisponibles } from "./catalogo-atributos-disponibles";

export async function usarAtributosEstructurados(): Promise<boolean> {
  return (await busquedaIaHabilitada()) && (await atributosEstructuradosDisponibles());
}
