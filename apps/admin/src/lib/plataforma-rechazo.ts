// Mensaje para el operador (usted) cuando la plataforma rechaza una escritura de atributos. Los
// `details` de un 400 invalid_data vienen del validador de la spec, en inglés y con un puntero JSON
// ("/ip/n must be <= 69"): se traduce a la clave y a un motivo legible. Lo que no se reconoce va
// tal cual; sin detalles, el código del error.

const RAIZ_ADICIONAL = /^\/\s+must NOT have additional properties \(([^)]+)\)$/
const CON_PUNTERO = /^\/([^/\s]+)\S*\s+(.+)$/

function motivo(texto: string): string {
  if (/must be [<>]=?\s*-?\d/.test(texto)) return "un valor está fuera de rango"
  if (/must be equal to one of the allowed values/.test(texto)) return "un valor no está entre los permitidos"
  if (/must be (number|integer|string|null|object|boolean)/.test(texto)) return "un valor no tiene el formato esperado"
  return "un valor no es válido"
}

function legible(detalle: string): string {
  const d = detalle.trim()
  const adicional = RAIZ_ADICIONAL.exec(d)
  if (adicional) return `la clave no está declarada en la plataforma (${adicional[1]})`
  const m = CON_PUNTERO.exec(d)
  if (m) return `${motivo(m[2])} (${m[1]})`
  return d
}

export function mensajeRechazoPlataforma(code: string, detalles: readonly string[]): string {
  const partes = detalles.filter((d) => d.trim()).map(legible)
  return `La plataforma rechazó los valores: ${partes.length ? partes.join("; ") : code}.`
}
