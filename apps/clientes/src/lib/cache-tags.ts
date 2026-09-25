/**
 * Tags de `cacheTag` del Shop (Cache Components). Un solo lugar para que el
 * que cachea y el que invalida usen el mismo string.
 *
 * - `home`: contenido de home_content (home, anuncio, badge del nav, footer y
 *   datos legales). Lo invalida el editor con `updateTag`.
 * - `catalogo` y `cuotas`: reservados para las cachés de datos (listado,
 *   ficha, nav, destacados y oferta de cuotas).
 */
export const TAG_HOME = "home";
export const TAG_CATALOGO = "catalogo";
export const TAG_CUOTAS = "cuotas";
