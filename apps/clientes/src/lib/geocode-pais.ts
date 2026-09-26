import type { Pais } from "./facturacion";

/**
 * País del formulario → `countrycodes` de Nominatim. Sólo los países que la
 * tienda factura; cualquier otro valor (o ninguno) cae en Argentina, que es
 * donde está casi toda la clientela.
 */
const CODIGOS: Record<Pais, string> = { AR: "ar", BR: "br", PY: "py" };

export function codigoPaisGeocode(pais: string | null | undefined): string {
  return CODIGOS[(pais ?? "").toUpperCase() as Pais] ?? "ar";
}

/** Idioma de los nombres que devuelve Nominatim: portugués en Brasil. */
export function idiomaGeocode(pais: string | null | undefined): string {
  return codigoPaisGeocode(pais) === "br" ? "pt" : "es";
}
