/**
 * Tags de `cacheTag` del Shop (Cache Components). Un solo lugar para que el
 * que cachea y el que invalida usen el mismo string.
 *
 * - `home`: contenido de home_content (home, anuncio, badge del nav, footer y
 *   datos legales). Lo invalida el editor con `updateTag`. NO lleva el tenant
 *   en el tag: cada tienda es su propio proyecto de Vercel, con su caché de
 *   datos y su `SHOP_TENANT_ID` fijo (no hay dos tenants en una misma caché).
 * - `catalogo` y `cuotas`: reservados para las cachés de datos (listado,
 *   ficha, nav, destacados y oferta de cuotas).
 */
export const TAG_HOME = "home";
export const TAG_CATALOGO = "catalogo";
/** Sucursales y zonas que el CRM carga en Configuración (`sucursales-datos.ts`). */
export const TAG_SUCURSALES = "sucursales";
