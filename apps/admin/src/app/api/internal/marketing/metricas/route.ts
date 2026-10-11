// src/app/api/internal/marketing/metricas/route.ts
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { guardarMetricas, listarMetricas } from "@/lib/marketing/otros-repo"

export const dynamic = "force-dynamic"
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const AMBITOS = ["pieza", "cuenta_ig", "ficha_google"] as const

export async function GET(req: Request) {
  const auth = autenticarInterno(req, ["planificador", "aiapi"])
  if (!auth.ok) return auth.response
  const q = new URL(req.url).searchParams
  const desde = q.get("desde") ?? ""
  const hasta = q.get("hasta") ?? ""
  if (!FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) return jsonInterno({ error: "invalid_fecha" }, 400)
  return jsonInterno({ items: await listarMetricas(auth.tenantId, desde, hasta) })
}

export async function POST(req: Request) {
  const auth = autenticarInterno(req, ["aiapi"])
  if (!auth.ok) return auth.response
  const b = (await req.json().catch(() => null)) as { filas?: unknown } | null
  if (!b || !Array.isArray(b.filas) || b.filas.length > 500) return jsonInterno({ error: "invalid_filas" }, 400)
  for (const f of b.filas as Record<string, unknown>[]) {
    const metricasOk = f.metricas && typeof f.metricas === "object" && Object.values(f.metricas).every((v) => typeof v === "number" && isFinite(v))
    if (!AMBITOS.includes(f.ambito as never) || typeof f.refId !== "string" || !FECHA_RE.test(String(f.fecha)) || !metricasOk) {
      return jsonInterno({ error: "invalid_fila" }, 400)
    }
  }
  const guardadas = await guardarMetricas(auth.tenantId, b.filas as never)
  return jsonInterno({ guardadas })
}
