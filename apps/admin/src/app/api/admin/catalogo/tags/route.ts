import { requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, duplicadoResponse, NO_STORE, validacionResponse } from "@/lib/catalogo-admin"
import { crearTag, listarTags } from "@/lib/catalogo-overlay-repo"

// GET  /api/admin/catalogo/tags — todas las etiquetas del tenant con su conteo EXACTO de
//      productos. Una etiqueta sin productos se lista igual, con 0.
// POST /api/admin/catalogo/tags — alta { nombre }. El identificador de URL se deriva del
//      nombre y es único por tenant: dos tenants pueden tener la misma etiqueta sin conflicto.
//
// Las etiquetas son planas: no aceptan padre ni nivel (no participan de la jerarquía).

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const tags = await listarTags(guard.tenantId)
  return Response.json({ tags }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const r = await crearTag(guard.tenantId, await req.json().catch(() => null))
  if (r.kind === "invalid") return validacionResponse(r.error, r.campo)
  if (r.kind === "duplicado") return duplicadoResponse("Ya existe una etiqueta con ese nombre", "nombre")
  if (r.kind !== "ok") return validacionResponse("No se pudo crear la etiqueta", "nombre")

  // Alta sin productos asociados: no mueve ninguna fila del delta, pero el diccionario de
  // etiquetas viaja con la taxonomía y conviene que la tienda lo tenga.
  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado, tag: { ...r.row, productos: 0 } }, { status: 201, headers: NO_STORE })
}
