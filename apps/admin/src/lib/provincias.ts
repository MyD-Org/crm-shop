// Las 24 jurisdicciones de Argentina (dato público). `claveProvincia` es la clave con la que se
// guarda y se compara una zona: misma normalización que `claveCiudad` del Shop (sin acentos,
// mayúsculas, espacios ni signos). El Shop tendrá su propia copia (sin workspaces).

export const PROVINCIAS = [
  "Buenos Aires",
  "Ciudad Autónoma de Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
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
] as const

export function claveProvincia(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

/** El nombre canónico de la lista fija, o null si no es una provincia conocida. */
export function provinciaCanonica(entrada: string | null | undefined): { clave: string; nombre: string } | null {
  if (!entrada) return null
  const clave = claveProvincia(entrada)
  if (!clave) return null
  const nombre = PROVINCIAS.find((p) => claveProvincia(p) === clave)
  return nombre ? { clave, nombre } : null
}
