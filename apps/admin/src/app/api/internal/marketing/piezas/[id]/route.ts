// src/app/api/internal/marketing/piezas/[id]/route.ts
import { autenticarInterno, jsonInterno, type ClienteInterno } from "@/lib/marketing/auth-interna"
import { esEstadoPieza, type ActorPieza } from "@/lib/marketing/estados"
import { pingStudio } from "@/lib/marketing/ping-studio"
import { obtenerPieza, transicionar } from "@/lib/marketing/piezas-repo"
import { validarCamposTransicion, WORKER_RE } from "@/lib/marketing/validar"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ id: string }> }

const ACTOR: Record<ClienteInterno, ActorPieza> = { studio: "studio", planificador: "planificador", aiapi: "aiapi" }

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
  // El studio identifica su claim con `worker`: sin uno válido no hay nada que cerrar.
  if (auth.cliente === "studio" && (typeof b.worker !== "string" || !WORKER_RE.test(b.worker))) return jsonInterno({ error: "invalid_worker" }, 400)
  const v = validarCamposTransicion(auth.cliente, b, auth.tenantId)
  if (!v.ok) return jsonInterno({ error: v.error }, 400)
  const r = await transicionar(auth.tenantId, id, b.estado, ACTOR[auth.cliente], {
    campos: v.campos,
    worker: auth.cliente === "studio" ? (b.worker as string) : undefined,
    nota: typeof b.nota === "string" ? b.nota.slice(0, 500) : undefined,
  })
  if (!r.ok) return jsonInterno({ error: r.code }, r.code === "not_found" ? 404 : 409)
  if (r.pieza.estado === "borrador") await pingStudio()
  return jsonInterno(r.pieza)
}
