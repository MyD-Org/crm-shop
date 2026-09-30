/**
 * Normaliza mientras se escribe un identificador (slug) de sucursal o de medio de pago: pasa a
 * minúsculas y reemplaza cada espacio por un guion, en vez de rechazar la mayúscula. Es solo
 * comodidad de la pantalla: la validación del servidor no cambia.
 */
export function normalizarIdentificador(valor: string): string {
  return valor.toLowerCase().replace(/\s/g, "-")
}
