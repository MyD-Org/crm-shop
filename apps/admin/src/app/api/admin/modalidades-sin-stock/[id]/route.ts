import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop } from "@/lib/aviso-shop"
import { actualizarModalidad, borrarModalidad } from "@/lib/modalidades-sin-stock-repo"

// PUT    /api/admin/modalidades-sin-stock/[id] — reemplaza la modalidad (404 si no es de este tenant).
// DELETE — la borra; los productos que la usaban quedan sin modalidad (el FK los deja en NULL).
// Ambas avisan al Shop tras persistir.

const NO_STORE = { "Cache-Control": "private, no-store" }

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const r = await actualizarModalidad(guard.tenantId, id, await req.json().catch(() => null))
  if (r.kind === "not_found") return adminNotFoundResponse()
  if (r.kind === "invalid") {
    return Response.json({ error: r.error, code: "invalid", campo: r.campo }, { status: 400, headers: NO_STORE })
  }

  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado, modalidad: r.modalidad }, { headers: NO_STORE })
}

export async function DELETE(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const r = await borrarModalidad(guard.tenantId, id)
  if (r.kind === "not_found") return adminNotFoundResponse()

  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado }, { headers: NO_STORE })
}
