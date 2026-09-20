import { requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, conflictoResponse, invalidResponse, NO_STORE } from "@/lib/catalogo-admin"
import { reordenarNivel } from "@/lib/catalogo-overlay-repo"

// PATCH /api/admin/catalogo/categorias/orden — reordena un NIVEL COMPLETO de una sola vez:
// { parentId: uuid|null, ids: [...] } con el orden final de todos los hermanos.
//
// Una sola llamada, no una por categoría: subir una posición es un PATCH con los hermanos
// afectados (REQ-TAX-03). Un conjunto incompleto o con repetidos se rechaza entero con 409 — así
// "el navegador tenía una lista vieja" no deja un orden corrupto a medias.

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

export async function PATCH(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  if (!esObjeto(body) || !Array.isArray(body.ids)) return invalidResponse("El orden es inválido", "ids")
  const parentId = body.parentId === undefined || body.parentId === null || body.parentId === "" ? null : body.parentId
  if (typeof parentId !== "string" && parentId !== null) return invalidResponse("La categoría padre es inválida", "parentId")

  const r = await reordenarNivel(guard.tenantId, parentId, body.ids as string[])
  if (r.kind === "invalid") return invalidResponse(r.error, r.campo)
  if (r.kind === "conjunto_invalido") {
    return conflictoResponse("El orden enviado no coincide con las categorías actuales. Vuelva a cargar la página.", "conjunto_invalido")
  }

  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado }, { headers: NO_STORE })
}
