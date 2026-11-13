/**
 * Email normalizado del invitado: trim + minúsculas. Es la clave con la que se cuentan sus pedidos
 * pendientes, se compara su cupón y (después) se reclaman sus pedidos. Módulo PURO.
 *
 * No se normalizan alias de Gmail (puntos, +etiqueta): sería asociar pedidos de direcciones que el
 * correo puede tratar como distintas. La regex es la misma que usan los mails del Shop.
 */
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LARGO_MAXIMO_EMAIL = 254;

/** trim + minúsculas; `null` si no parece un email. */
export function normalizarEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length > 0 && e.length <= LARGO_MAXIMO_EMAIL && EMAIL_VALIDO.test(e) ? e : null;
}
