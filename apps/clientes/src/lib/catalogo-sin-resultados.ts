import type { EstadoCatalogo } from "./catalogo-url";
import type { LocalFiltro } from "./catalogo-vista";
import { TEXTOS_SIN_RESULTADOS } from "./busqueda-inteligente/textos";
import { formatRubro } from "./formato-rubro";

/**
 * Copy del "sin resultados" cuando el filtro "Con stock en <local>" está activo
 * (puesto a mano o recordado por la cookie del local): el visitante tiene que
 * saber que el 0 puede venir de ese filtro y cómo salir. Devuelve `null` si no
 * hay filtro de local; entonces rige el copy de siempre.
 *
 * La salida ("Ver en todos los locales") la resuelve el componente quitando
 * `retiroEn` del estado, igual que el chip y el panel.
 */
export function sinResultadosPorLocal(
  estado: EstadoCatalogo,
  locales: LocalFiltro[],
  consulta: string | undefined,
): { titulo: string; descripcion: string; accion: string } | null {
  if (!estado.retiroEn) return null;
  const nombre = locales.find((l) => l.slug === estado.retiroEn)?.nombre ?? estado.retiroEn;
  return {
    titulo: TEXTOS_SIN_RESULTADOS.tituloLocal(nombre, consulta?.trim() || undefined),
    descripcion: TEXTOS_SIN_RESULTADOS.descripcionLocal,
    accion: TEXTOS_SIN_RESULTADOS.verEnTodosLosLocales,
  };
}

/**
 * Copy del "sin resultados" cuando hay texto buscado y categorías tildadas: el 0 sale de combinar
 * la búsqueda con la categoría (p. ej. «Plafón 60x60» en Herramientas), no de la búsqueda sola.
 * Las dos salidas las resuelve el componente: quitar las categorías (vuelve a la búsqueda) o quitar
 * la búsqueda (la categoría completa). `null` sin búsqueda o sin categorías.
 */
export function sinResultadosPorCategoria(
  estado: EstadoCatalogo,
  consulta: string | undefined,
): { titulo: string; descripcion: string; quitar: string; verSinBusqueda: string } | null {
  const texto = consulta?.trim();
  if (!texto || estado.categorias.length === 0) return null;
  const nombres = estado.categorias.map(formatRubro).join(" o ");
  return {
    titulo: TEXTOS_SIN_RESULTADOS.tituloCategoria(texto, nombres),
    descripcion: TEXTOS_SIN_RESULTADOS.descripcionCategoria,
    quitar: TEXTOS_SIN_RESULTADOS.quitarCategoria(nombres),
    verSinBusqueda: TEXTOS_SIN_RESULTADOS.verCategoriaSinBusqueda(nombres),
  };
}
