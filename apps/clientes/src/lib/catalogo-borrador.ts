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
 * Una excepción, con las facetas por tipo prendidas: elegir o quitar una
 * categoría se aplica en el acto (`hrefAlElegirCategoria`), porque los filtros
 * por tipo de producto dependen de ella y hay que traerlos para mostrarlos.
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
    atributos: e.atributos,
    caracteristicas: e.caracteristicas,
    precioMin: e.precioMin,
    precioMax: e.precioMax,
    potenciaMin: e.potenciaMin,
    potenciaMax: e.potenciaMax,
    soloStock: e.soloStock,
    retiroEn: e.retiroEn,
    orden: e.orden,
  };
}

function sinCambios(a: EstadoCatalogo, b: EstadoCatalogo): boolean {
  return (
    mismaLista(a.categorias, b.categorias) &&
    mismaLista(a.marcas, b.marcas) &&
    mismaLista(a.atributos, b.atributos) &&
    mismaLista(a.caracteristicas, b.caracteristicas) &&
    a.precioMin === b.precioMin &&
    a.precioMax === b.precioMax &&
    a.potenciaMin === b.potenciaMin &&
    a.potenciaMax === b.potenciaMax &&
    a.soloStock === b.soloStock &&
    a.retiroEn === b.retiroEn &&
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
  const cambios = manejaLaHoja(borrador);
  // Las características son de ESTA categoría: si el borrador la cambió, no viajan.
  if (!mismaLista(estado.categorias, borrador.categorias)) cambios.caracteristicas = [];
  return hrefCon(estado, cambios);
}

/**
 * Borrador después de elegir (o quitar) categorías en la hoja: cambia las
 * categorías, descarta las características (son de la categoría anterior) y
 * conserva el resto de lo que ya estaba en el borrador.
 */
export function borradorAlElegirCategoria(
  borrador: EstadoCatalogo,
  categorias: string[]
): EstadoCatalogo {
  return cambiarBorrador(borrador, { categorias, caracteristicas: [] });
}

/**
 * URL a la que navega la hoja al elegir una categoría, sin esperar "Aplicar":
 * lleva el borrador COMPLETO (precio, marcas, orden, etc.) con la categoría
 * nueva y sin características. `null` si no hay nada que aplicar.
 */
export function hrefAlElegirCategoria(
  estado: EstadoCatalogo,
  borrador: EstadoCatalogo,
  categorias: string[]
): string | null {
  return hrefAlAplicar(estado, borradorAlElegirCategoria(borrador, categorias));
}
