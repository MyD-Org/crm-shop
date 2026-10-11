// src/app/api/internal/marketing/solicitudes/[id]/resolver/route.ts
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { resolverSolicitud } from "@/lib/marketing/otros-repo"

export const dynamic = "force-dynamic"

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = autenticarInterno(req, ["planificador"])
  if (!auth.ok) return auth.response
  const b = (await req.json().catch(() => null)) as { ok?: unknown; resultado?: unknown } | null
  if (!b || typeof b.ok !== "boolean") return jsonInterno({ error: "invalid_ok" }, 400)
  const s = await resolverSolicitud(auth.tenantId, (await ctx.params).id, b.ok, typeof b.resultado === "string" ? b.resultado.slice(0, 1000) : "")
  return s ? jsonInterno(s) : jsonInterno({ error: "not_found" }, 404)
}
