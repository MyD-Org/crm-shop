// Helpers puros de "Desde dónde sale el envío" (Datos, Envíos): pasan las ciudades de envío entre
// el texto del campo (separadas por coma) y la lista que guarda la API de sucursales.

export const ciudadesATexto = (ciudades: readonly string[]): string => ciudades.join(", ")

export const textoACiudades = (texto: string): string[] =>
  texto
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
