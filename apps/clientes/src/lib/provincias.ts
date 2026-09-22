/**
 * Provincias argentinas (las 23 más la Ciudad Autónoma de Buenos Aires).
 * Módulo puro: lo usan el formulario de direcciones (cliente) y la validación
 * de la API (servidor), con la misma lista.
 */

export const PROVINCIAS_AR = [
  "Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Ciudad Autónoma de Buenos Aires",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
] as const;

export type ProvinciaAR = (typeof PROVINCIAS_AR)[number];

function clave(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^provincia\s+de\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Otros nombres con los que llega una provincia: el geocodificador (OSM) y la
 * gente escriben CABA de varias formas, y Tierra del Fuego con su nombre largo.
 */
const ALIAS: Record<string, ProvinciaAR> = {
  caba: "Ciudad Autónoma de Buenos Aires",
  capitalfederal: "Ciudad Autónoma de Buenos Aires",
  ciudaddebuenosaires: "Ciudad Autónoma de Buenos Aires",
  tierradelfuegoantartidaeislasdelatlanticosur: "Tierra del Fuego",
};

const POR_CLAVE = new Map<string, ProvinciaAR>(PROVINCIAS_AR.map((p) => [clave(p), p]));

/**
 * El nombre de la lista para lo que haya escrito el usuario o devuelto el
 * geocodificador, o null si no es una provincia argentina.
 */
export function provinciaCanonica(v: string | null | undefined): ProvinciaAR | null {
  if (!v) return null;
  const k = clave(v.trim());
  if (!k) return null;
  return POR_CLAVE.get(k) ?? ALIAS[k] ?? null;
}
