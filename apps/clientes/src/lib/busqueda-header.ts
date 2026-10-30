/**
 * Texto que corresponde al buscador del header para una URL: la búsqueda aplicada en el catálogo
 * (`?q=`, adonde llevan el buscador y `/buscar`), y en cualquier otra página nada. Así el buscador
 * no muestra una búsqueda que ya no filtra (al ir a una ficha, a la home, o al sacarla del catálogo).
 */
export function busquedaAplicada(pathname: string | null, params: URLSearchParams): string {
  return pathname === "/catalogo" ? (params.get("q") ?? "") : "";
}
