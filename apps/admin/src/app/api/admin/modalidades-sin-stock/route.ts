import { requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop } from "@/lib/aviso-shop"
import { crearModalidad, listarModalidades } from "@/lib/modalidades-sin-stock-repo"

// GET  /api/admin/modalidades-sin-stock — modalidades del tenant, por nombre.
// POST — crea una (201). Tras persistir se avisa al Shop (best-effort; la respuesta trae
// `propagado`): cambia lo que el catálogo lista. El tenant sale SOLO del guard.

const NO_STORE = { "Cache-Control": "private, no-store" }

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  return Response.json({ modalidades: await listarModalidades(guard.tenantId) }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const r = await crearModalidad(guard.tenantId, await req.json().catch(() => null))
  if (r.kind !== "ok") {
    const campo = r.kind === "invalid" ? r.campo : "body"
    const error = r.kind === "invalid" ? r.error : "Los datos indicados no son válidos."
    return Response.json({ error, code: "invalid", campo }, { status: 400, headers: NO_STORE })
  }

  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado, modalidad: r.modalidad }, { status: 201, headers: NO_STORE })
}
