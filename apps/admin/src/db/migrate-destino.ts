/** A qué base apunta una conexión, sin la contraseña. `local` = la máquina propia. */
export function destinoMigracion(url: string): { host: string; base: string; local: boolean } {
  const u = new URL(url)
  const host = u.hostname
  const base = u.pathname.replace(/^\//, "") || "(sin base)"
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === ""
  return { host, base, local }
}
