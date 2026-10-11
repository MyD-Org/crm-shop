import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { crearSolicitud } from "@/lib/marketing/otros-repo"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const b = (await req.json().catch(() => null)) as { tipo?: unknown; nota?: unknown } | null
  if (b?.tipo !== "plan_semana") return Response.json({ error: "Tipo de solicitud inválido", code: "invalid_tipo" }, { status: 400, headers: NO_STORE })
  const s = await crearSolicitud(guard.tenantId, "plan_semana", { nota: typeof b.nota === "string" ? b.nota.slice(0, 1000) : "" })
  return Response.json(s, { status: 201, headers: NO_STORE })
}
