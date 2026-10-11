// src/app/api/internal/marketing/piezas/[id]/route.ts
import { autenticarInterno, jsonInterno, type ClienteInterno } from "@/lib/marketing/auth-interna"
import { esEstadoPieza, type ActorPieza } from "@/lib/marketing/estados"
import { pingStudio } from "@/lib/marketing/ping-studio"
import { obtenerPieza, transicionar, type CamposTransicion } from "@/lib/marketing/piezas-repo"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ id: string }> }

const ACTOR: Record<ClienteInterno, ActorPieza> = { studio: "studio", planificador: "planificador", aiapi: "aiapi" }
// Campos que cada cliente puede escribir junto con la transición.
const CAMPOS: Record<ClienteInterno, (keyof CamposTransicion)[]> = {
  studio: ["renderKey", "portadaKey", "alertas"],
  planificador: ["contenido", "caption", "hashtags", "briefGrabacion", "alertas", "chequeoIa"],
  aiapi: ["externoId", "permalink"],
}

export async function GET(req: Request, ctx: Ctx) {
  const auth = autenticarInterno(req, ["studio", "planificador", "aiapi"])
  if (!auth.ok) return auth.response
  const pieza = await obtenerPieza(auth.tenantId, (await ctx.params).id)
  return pieza ? jsonInterno(pieza) : jsonInterno({ error: "not_found" }, 404)
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = autenticarInterno(req, ["studio", "planificador", "aiapi"])
  if (!auth.ok) return auth.response
  const { id } = await ctx.params
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b || !esEstadoPieza(b.estado)) return jsonInterno({ error: "invalid_estado" }, 400)
  const campos: CamposTransicion = {}
  for (const k of CAMPOS[auth.cliente]) if (k in b) (campos as Record<string, unknown>)[k] = b[k]
  const r = await transicionar(auth.tenantId, id, b.estado, ACTOR[auth.cliente], {
    campos,
    worker: typeof b.worker === "string" ? b.worker : undefined,
    nota: typeof b.nota === "string" ? b.nota.slice(0, 500) : undefined,
  })
  if (!r.ok) return jsonInterno({ error: r.code }, r.code === "not_found" ? 404 : 409)
  if (r.pieza.estado === "borrador") await pingStudio()
  return jsonInterno(r.pieza)
}
