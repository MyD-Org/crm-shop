import type { EstadoCatalogo } from "./catalogo-url";
import type { LocalFiltro } from "./catalogo-vista";
import { TEXTOS_SIN_RESULTADOS } from "./busqueda-inteligente/textos";

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
