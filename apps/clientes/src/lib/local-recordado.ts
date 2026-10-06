/**
 * Local recordado: el enlace especial `/?sucursal=<local>` (o cualquier página con ese parámetro;
 * `?retiro=` también vale, es el que usa el catálogo) guarda el local en una cookie, y desde ahí
 * todo ingreso al catálogo llega con el filtro "Con stock en <local>" puesto y visible (chip y
 * panel). `?sucursal=todos` lo olvida. En `/catalogo`, `sucursal` se traduce a `retiro`.
 *
 * La regla es pura: el proxy la aplica (cookie + redirect de `/catalogo`) y el catálogo, al
 * quitar el filtro, borra la cookie del lado del cliente (`olvidarLocalRecordado`) para que el
 * redirect no lo vuelva a poner. Una búsqueda (`?q=`) no recibe el local recordado: arranca
 * limpia, sin filtros previos (un `?retiro=` explícito en esa URL sí se respeta). El slug no se valida contra las sucursales: uno desconocido lo
 * descarta el catálogo como siempre (filtro en "cualquier local").
 */

export const LOCAL_COOKIE = "local_retiro";
/** Valor de `?sucursal=` / `?retiro=` que borra el local recordado. */
export const LOCAL_TODOS = "todos";
export const LOCAL_MAX_AGE = 60 * 60 * 24 * 30;

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

function comoSlug(v: string | null | undefined): string | undefined {
  const s = v?.trim().toLowerCase();
  return s && s !== LOCAL_TODOS && SLUG.test(s) ? s : undefined;
}

export type DecisionLocal = {
  cookie: { accion: "ninguna" } | { accion: "borrar" } | { accion: "guardar"; local: string };
  /** Query string (sin `?`) a la que redirigir `/catalogo`, o undefined para seguir. */
  redirigirA?: string;
};

export function decidirLocal({
  pathname,
  search,
  cookie,
}: {
  pathname: string;
  search: URLSearchParams;
  cookie: string | undefined;
}): DecisionLocal {
  const param = search.get("sucursal") ?? search.get("retiro");
  const previa = comoSlug(cookie);
  const esCatalogo = pathname === "/catalogo";
  const todos = param?.trim().toLowerCase() === LOCAL_TODOS;
  const local = comoSlug(param);

  const decision: DecisionLocal = todos
    ? { cookie: cookie ? { accion: "borrar" } : { accion: "ninguna" } }
    : local
      ? { cookie: local === previa ? { accion: "ninguna" } : { accion: "guardar", local } }
      : { cookie: { accion: "ninguna" } };
  if (!esCatalogo) return decision;

  // En el catálogo el filtro viaja como `retiro`: se traduce `sucursal`, se saca `todos` y,
  // sin parámetro, se agrega el local recordado.
  if (search.has("sucursal") || todos) {
    const sp = new URLSearchParams(search);
    sp.delete("sucursal");
    sp.delete("retiro");
    if (local) sp.set("retiro", local);
    return { ...decision, redirigirA: sp.toString() };
  }
  // Una búsqueda (`q` con texto) arranca limpia: no hereda el local recordado. La cookie queda,
  // así que al volver a navegar el catálogo sin buscar el filtro sigue puesto.
  const buscando = Boolean(search.get("q")?.trim());
  if (param == null && previa && !buscando) {
    const sp = new URLSearchParams(search);
    sp.set("retiro", previa);
    return { ...decision, redirigirA: sp.toString() };
  }
  return decision;
}

/**
 * Lado cliente: al navegar dentro del catálogo a una URL sin `retiro` (el cliente quitó el
 * filtro), borra la cookie antes de navegar; si no, el proxy lo volvería a poner.
 */
export function olvidarLocalRecordado(href: string): void {
  if (typeof document === "undefined") return;
  const qs = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
  if (new URLSearchParams(qs).has("retiro")) return;
  if (!document.cookie.split("; ").some((c) => c.startsWith(`${LOCAL_COOKIE}=`))) return;
  document.cookie = `${LOCAL_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
