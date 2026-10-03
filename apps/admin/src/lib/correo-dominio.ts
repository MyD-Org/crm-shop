import { promises as dns } from "node:dns"

// Chequeo de que un dominio recibe correo (solo servidor). MX; si no hay, A/AAAA como fallback
// (RFC 5321 §5.1). Solo "no existe / sin registros" bloquea: un timeout o error de DNS deja pasar.

interface Resolver {
  resolveMx(d: string): Promise<{ exchange: string; priority: number }[]>
  resolve4(d: string): Promise<string[]>
  resolve6(d: string): Promise<string[]>
}

const SIN_REGISTROS = new Set(["ENODATA", "ENOTFOUND"])
const codigo = (e: unknown): string => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "")

async function consulta<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p
  } catch (e) {
    if (SIN_REGISTROS.has(codigo(e))) return []
    throw e
  }
}

async function chequear(dominio: string, r: Resolver): Promise<boolean> {
  const mx = await consulta(r.resolveMx(dominio))
  if (mx.length > 0) return mx.some((m) => m.exchange.trim() !== "" && m.exchange !== ".")
  const a = await consulta(r.resolve4(dominio))
  if (a.length > 0) return true
  return (await consulta(r.resolve6(dominio))).length > 0
}

export async function dominioRecibeCorreo(dominio: string, resolver: Resolver = dns, timeoutMs = 3000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs)
  })
  try {
    return await Promise.race([chequear(dominio, resolver).catch(() => true), limite])
  } finally {
    clearTimeout(timer)
  }
}
