/**
 * Enlace con local: `/catalogo?sucursal=<local>` abre el catálogo con el filtro
 * "Con stock en <local>" (en el catálogo el filtro viaja como `retiro`). Es sólo
 * ese ingreso: el local no se recuerda y la próxima entrada al catálogo arranca
 * sin filtro. `?sucursal=todos` llega sin filtro de local.
 *
 * Antes el local se guardaba en la cookie `local_retiro` y el proxy lo volvía a
 * poner en cada ingreso; se sacó (el filtro quedaba pegado y, con las precargas
 * del router, volvía después de quitarlo). `recordado` era el marcador de esa
 * redirección: si llega en un link viejo, se saca.
 *
 * El slug no se valida contra las sucursales: uno desconocido lo descarta el
 * catálogo como siempre (filtro en "cualquier local").
 */

const TODOS = "todos";
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Query string (sin `?`) a la que redirigir `/catalogo`, o undefined para seguir. */
export function redireccionSucursal(pathname: string, search: URLSearchParams): string | undefined {
  if (pathname !== "/catalogo") return undefined;
  if (!search.has("sucursal") && !search.has("recordado")) return undefined;

  const sp = new URLSearchParams(search);
  const sucursal = sp.get("sucursal")?.trim().toLowerCase();
  sp.delete("sucursal");
  sp.delete("recordado");
  if (sucursal === TODOS) sp.delete("retiro");
  else if (sucursal && SLUG.test(sucursal)) sp.set("retiro", sucursal);
  return sp.toString();
}
