/**
 * Rol admin del Shop: Clerk → Users → Metadata → Public → {"role":"admin"}.
 * Puro: sin Clerk. Comparación estricta de string; cualquier otro valor o
 * tipo (mayúsculas, sinónimos, booleanos, arrays) no otorga admin.
 */
export function esRolAdmin(meta: unknown): boolean {
  return !!meta && typeof meta === "object" && (meta as { role?: unknown }).role === "admin";
}
