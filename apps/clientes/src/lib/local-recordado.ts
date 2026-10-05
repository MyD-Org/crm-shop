/**
 * Local recordado: el enlace especial `/?retiro=<local>` (o cualquier página con ese parámetro)
 * guarda el local en una cookie, y desde ahí todo ingreso al catálogo llega con el filtro
 * "Con stock en <local>" puesto y visible (chip y panel). `?retiro=todos` lo olvida.
 *
 * La regla es pura: el proxy la aplica (cookie + redirect de `/catalogo`) y el catálogo, al
 * quitar el filtro, borra la cookie del lado del cliente (`olvidarLocalRecordado`) para que el
 * redirect no lo vuelva a poner. El slug no se valida contra las sucursales: uno desconocido lo
 * descarta el catálogo como siempre (filtro en "cualquier local").
 */

export const LOCAL_COOKIE = "local_retiro";
/** Valor de `?retiro=` que borra el local recordado. */
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
  const param = search.get("retiro");
  const previa = comoSlug(cookie);
  const esCatalogo = pathname === "/catalogo";

  if (param?.trim().toLowerCase() === LOCAL_TODOS) {
    const sin = new URLSearchParams(search);
    sin.delete("retiro");
    return {
      cookie: cookie ? { accion: "borrar" } : { accion: "ninguna" },
      ...(esCatalogo ? { redirigirA: sin.toString() } : {}),
    };
  }

  const local = comoSlug(param);
  if (local) {
    return { cookie: local === previa ? { accion: "ninguna" } : { accion: "guardar", local } };
  }

  if (param == null && previa && esCatalogo) {
    const con = new URLSearchParams(search);
    con.set("retiro", previa);
    return { cookie: { accion: "ninguna" }, redirigirA: con.toString() };
  }

  return { cookie: { accion: "ninguna" } };
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
