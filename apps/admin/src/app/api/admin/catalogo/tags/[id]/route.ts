import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, duplicadoResponse, NO_STORE, validacionResponse } from "@/lib/catalogo-admin"
import { borrarTag, impactoBorrarTag, renombrarTag } from "@/lib/catalogo-overlay-repo"

// GET    /api/admin/catalogo/tags/[id] — a cuántos productos les sacaría el borrado la etiqueta.
//        Se informa ANTES de confirmar, igual que con las categorías.
// PATCH  — renombrar. NO toca ninguna fila de producto: los productos referencian el
//        identificador, que no cambia, así que un rename sobre 800 productos impacta a los 800
//        de una sola vez y no empuja ni uno al delta de la tienda.
// DELETE — borrar. Los productos siguen existiendo con el resto de sus datos intactos; sí se
//        arrastran al delta, porque su conjunto de etiquetas cambió de verdad.

type Params = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const productos = await impactoBorrarTag(guard.tenantId, id)
  if (productos === null) return adminNotFoundResponse()
  return Response.json({ impacto: { productos } }, { headers: NO_STORE })
}

export async function PATCH(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const r = await renombrarTag(guard.tenantId, id, await req.json().catch(() => null))
  if (r.kind === "not_found") return adminNotFoundResponse()
  if (r.kind === "invalid") return validacionResponse(r.error, r.campo)
  if (r.kind === "duplicado") return duplicadoResponse("Ese nombre ya está en uso por otra etiqueta", "nombre")

  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado, tag: r.row }, { headers: NO_STORE })
}

export async function DELETE(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const r = await borrarTag(guard.tenantId, id)
  if (r.kind === "not_found") return adminNotFoundResponse()
  if (r.kind !== "ok") return validacionResponse("No se pudo eliminar la etiqueta", "nombre")

  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado }, { headers: NO_STORE })
}
