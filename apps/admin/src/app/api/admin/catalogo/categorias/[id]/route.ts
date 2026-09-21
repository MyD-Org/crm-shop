import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, conflictoResponse, duplicadoResponse, NO_STORE, validacionResponse } from "@/lib/catalogo-admin"
import { actualizarCategoria, borrarCategoria, impactoBorrarCategoria } from "@/lib/catalogo-overlay-repo"

// GET    /api/admin/catalogo/categorias/[id] — impacto del borrado: cuántos productos pasarían
//        a "Sin clasificar" y cuántas subcategorías tiene. Se informa ANTES de confirmar.
// PATCH  — edición (incluye mover de padre, que se valida antes de escribir).
// DELETE — baja. Con hijas es 409 (nunca una categoría apuntando a un padre inexistente). Los
//        productos NO se borran ni se despublican: pasan a "Sin clasificar" conservando nombre,
//        etiquetas, fotos y visibilidad, y su marca temporal avanza para que el cambio viaje.
//
// Un id inexistente o de otro tenant devuelve el MISMO 404 que el guard de operator.

type Params = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const impacto = await impactoBorrarCategoria(guard.tenantId, id)
  if (!impacto) return adminNotFoundResponse()
  return Response.json({ impacto }, { headers: NO_STORE })
}

export async function PATCH(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const r = await actualizarCategoria(guard.tenantId, id, await req.json().catch(() => null))
  if (r.kind === "not_found") return adminNotFoundResponse()
  if (r.kind === "invalid") return validacionResponse(r.error, r.campo)
  if (r.kind === "duplicado") return duplicadoResponse("Ya existe una categoría con ese nombre en ese nivel", "nombre")
  if (r.kind !== "ok") return conflictoResponse("No se pudo modificar la categoría", "conflicto")

  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado, categoria: r.row }, { headers: NO_STORE })
}

export async function DELETE(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  const r = await borrarCategoria(guard.tenantId, id)
  if (r.kind === "not_found") return adminNotFoundResponse()
  if (r.kind === "con_hijas") {
    return conflictoResponse("Primero elimine o mueva las subcategorías", "con_hijas")
  }
  if (r.kind !== "ok") return conflictoResponse("No se pudo eliminar la categoría", "conflicto")

  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado }, { headers: NO_STORE })
}
