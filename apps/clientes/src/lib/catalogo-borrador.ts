/**
 * Borrador de la hoja de filtros de mobile (spec MOB-2).
 *
 * En mobile cada toque no navega: los cambios se acumulan en un borrador
 * local (un `EstadoCatalogo` completo, sembrado desde la URL al abrir la
 * hoja) y se aplican en UNA navegación con "Aplicar" — incluido el orden, que
 * en mobile vive adentro de la hoja. Cerrar sin aplicar descarta el borrador.
 * Los conteos y el rango que muestra la hoja son los de la URL vigente: no se
 * recalculan con el borrador.
 *
 * Módulo puro (sin React): el Shop no tiene tests de render.
 */
import { hrefCon, type EstadoCatalogo } from "@/lib/catalogo-url";
import { limpiarFiltros } from "@/lib/catalogo-vista";

/**
 * Aplica cambios al borrador. Mismo contrato que `hrefCon`: un cambio con
 * `undefined` borra el valor (el spread lo pisa).
 */
export function cambiarBorrador(
  borrador: EstadoCatalogo,
  cambios: Partial<EstadoCatalogo>
): EstadoCatalogo {
  return { ...borrador, ...cambios };
}

/** "Limpiar filtros" dentro de la hoja: vacía el borrador, no navega. */
export function limpiarBorrador(borrador: EstadoCatalogo): EstadoCatalogo {
  return cambiarBorrador(borrador, limpiarFiltros());
}

/** Misma selección, sin importar el orden en que se tildó. */
const mismaLista = (a: string[], b: string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/**
 * Lo que maneja la hoja: lo único que el borrador puede cambiar. Incluye el
 * orden, que en mobile se elige adentro de la hoja y no afuera (afuera sólo
 * queda la vista). No es un filtro —no suma al contador del botón ni lo toca
 * "Limpiar filtros"— pero viaja en la misma navegación de "Aplicar".
 */
function manejaLaHoja(e: EstadoCatalogo): Partial<EstadoCatalogo> {
  return {
    categorias: e.categorias,
    marcas: e.marcas,
    precioMin: e.precioMin,
    precioMax: e.precioMax,
    soloStock: e.soloStock,
    orden: e.orden,
  };
}

function sinCambios(a: EstadoCatalogo, b: EstadoCatalogo): boolean {
  return (
    mismaLista(a.categorias, b.categorias) &&
    mismaLista(a.marcas, b.marcas) &&
    a.precioMin === b.precioMin &&
    a.precioMax === b.precioMax &&
    a.soloStock === b.soloStock &&
    a.orden === b.orden
  );
}

/**
 * URL a la que navega "Aplicar", o `null` si el borrador no cambió nada (se
 * cierra la hoja sin navegar). Parte de la URL vigente: la búsqueda y la vista
 * se conservan y la página vuelve a 1, como con cualquier filtro. El orden sí
 * sale del borrador: se elige adentro de la hoja.
 */
export function hrefAlAplicar(estado: EstadoCatalogo, borrador: EstadoCatalogo): string | null {
  if (sinCambios(estado, borrador)) return null;
  return hrefCon(estado, manejaLaHoja(borrador));
}
