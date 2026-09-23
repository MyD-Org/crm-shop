/**
 * El portal se entra SOLO con CUIT o DNI: es lo que el cliente siempre tiene a mano y
 * lo que identifica la cuenta en Alegra sin ambigüedad (un email puede estar repetido
 * o no estar cargado).
 *
 * Acepta dígitos con guiones, puntos o espacios ("20-12345678-9", "20.123.456.789").
 * Devuelve solo los dígitos, o null si no es un documento: letras, un email, o una
 * cantidad de dígitos que no es ni DNI (6 a 8, los muy viejos tienen 6) ni CUIT (11).
 */
export function normalizarDocumento(raw: string): string | null {
  const texto = raw.trim()
  if (!/^[\d\s.\-]+$/.test(texto)) return null
  const digitos = texto.replace(/\D/g, "")
  if (digitos.length < 6 || digitos.length > 11) return null
  return digitos
}
