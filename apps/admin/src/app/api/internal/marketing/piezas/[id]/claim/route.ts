// src/app/api/internal/marketing/piezas/[id]/claim/route.ts
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { reclamarPieza } from "@/lib/marketing/piezas-repo"
import { WORKER_RE } from "@/lib/marketing/validar"

export const dynamic = "force-dynamic"

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = autenticarInterno(req, ["studio"])
  if (!auth.ok) return auth.response
  const b = (await req.json().catch(() => null)) as { worker?: unknown; ttlSeg?: unknown } | null
  if (!b || typeof b.worker !== "string" || !WORKER_RE.test(b.worker)) return jsonInterno({ error: "invalid_worker" }, 400)
  const ttl = typeof b.ttlSeg === "number" ? b.ttlSeg : 600
  const pieza = await reclamarPieza(auth.tenantId, (await ctx.params).id, b.worker, ttl)
  return pieza ? jsonInterno(pieza) : jsonInterno({ error: "not_claimable" }, 409)
}
