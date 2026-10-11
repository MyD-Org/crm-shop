// src/lib/marketing/ping-studio.ts
// Aviso sin payload al studio cuando hay una pieza nueva en borrador. Nunca lanza: el studio
// igual hace polling cada 60 s, el ping sólo acorta la espera.
const PING_TIMEOUT_MS = 5000

export async function pingStudio(): Promise<{ propagado: boolean }> {
  const base = process.env.MARKETING_STUDIO_URL?.trim()
  const secret = process.env.MARKETING_STUDIO_SECRET
  if (!base || !secret) return { propagado: false }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/ping`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: controller.signal,
      cache: "no-store",
    })
    return { propagado: res.ok }
  } catch (err) {
    console.warn(`[marketing] ping al studio falló: ${err instanceof Error ? err.name : "error"}`)
    return { propagado: false }
  } finally {
    clearTimeout(timer)
  }
}
