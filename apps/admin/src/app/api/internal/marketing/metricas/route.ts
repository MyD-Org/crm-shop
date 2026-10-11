// src/app/api/internal/marketing/metricas/route.ts
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { guardarMetricas, listarMetricas } from "@/lib/marketing/otros-repo"
import { fechaValida, filaMetricaValida } from "@/lib/marketing/validar"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const auth = autenticarInterno(req, ["planificador", "aiapi"])
  if (!auth.ok) return auth.response
  const q = new URL(req.url).searchParams
  const desde = q.get("desde") ?? ""
  const hasta = q.get("hasta") ?? ""
  if (!fechaValida(desde) || !fechaValida(hasta)) return jsonInterno({ error: "invalid_fecha" }, 400)
  return jsonInterno({ items: await listarMetricas(auth.tenantId, desde, hasta) })
}

export async function POST(req: Request) {
  const auth = autenticarInterno(req, ["aiapi"])
  if (!auth.ok) return auth.response
  const b = (await req.json().catch(() => null)) as { filas?: unknown } | null
  if (!b || !Array.isArray(b.filas) || b.filas.length > 500) return jsonInterno({ error: "invalid_filas" }, 400)
  if (!b.filas.every(filaMetricaValida)) return jsonInterno({ error: "invalid_fila" }, 400)
  const guardadas = await guardarMetricas(auth.tenantId, b.filas as never)
  return jsonInterno({ guardadas })
}
