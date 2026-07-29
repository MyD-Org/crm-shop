import { timingSafeEqual } from "crypto";

/**
 * Comparación de strings en tiempo constante, para secretos compartidos
 * (CRON_SECRET). Evita el early-return de `===`, que filtra por timing cuántos
 * caracteres coinciden.
 *
 * `timingSafeEqual` exige buffers del mismo largo; si difieren cortamos antes
 * (el largo de un secreto no es sensible). Compara sobre bytes UTF-8.
 */
export function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Helper para el patrón `Authorization: Bearer <secret>`. Devuelve true solo si
 * el header trae exactamente el secreto esperado (y el secreto está configurado:
 * sin CRON_SECRET seteado, nadie pasa).
 */
export function bearerMatches(
  authHeader: string | null,
  expectedSecret: string | undefined
): boolean {
  if (!expectedSecret) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  return secureCompare(authHeader.slice(7), expectedSecret);
}
