import { requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, invalidResponse, NO_STORE, parsearSeleccion, validacionResponse } from "@/lib/catalogo-admin"
import { masivaOverlay, masivaTags, type Seleccion } from "@/lib/catalogo-overlay-repo"

// POST /api/admin/catalogo/productos/masiva — publicar, ocultar, asignar categoría o etiqueta
// sobre una selección.
//
// Body: { seleccion, accion }
//   seleccion: { tipo:"ids", alegraIds } | { tipo:"filtro", filtros, excluir }
//   accion:    { tipo:"visible", valor } | { tipo:"categoria", categoriaId }
//            | { tipo:"tag", tagId, modo:"agregar"|"quitar" }
//
// La selección por FILTRO se re-evalúa en el servidor en una sola sentencia: "todo lo que
// coincide" pueden ser ~5959 productos y el navegador no manda esa lista (REQ-ADM-03). La
// respuesta trae `afectados` contado por el servidor — es el número que vale, no el que contó
// el cliente: el conjunto puede haber cambiado si la sync de Alegra corrió en el medio.
//
// Cada acción es una sola transacción: o se aplica a todo el conjunto o a ninguno. Repetirla es
// inofensivo (ocultar dos veces no es error, REQ-PUB-05).

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const seleccion = parsearSeleccion(body)
  if (seleccion instanceof Response) return seleccion

  const accion = esObjeto(body) && esObjeto(body.accion) ? body.accion : null
  if (!accion) return invalidResponse("Seleccione una acción", "accion")

  const r = await ejecutar(guard.tenantId, seleccion, accion, guard.user.id)
  if (r instanceof Response) return r
  if (r.kind !== "ok") return validacionResponse(r.error, r.campo)

  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado, afectados: r.afectados }, { headers: NO_STORE })
}

async function ejecutar(
  tenantId: string,
  seleccion: Seleccion,
  accion: Record<string, unknown>,
  updatedBy: string,
) {
  if (accion.tipo === "visible") {
    if (typeof accion.valor !== "boolean") return invalidResponse("Estado de publicación inválido", "valor")
    return masivaOverlay(tenantId, seleccion, { tipo: "visible", valor: accion.valor }, updatedBy)
  }
  if (accion.tipo === "categoria") {
    const categoriaId = accion.categoriaId
    if (categoriaId !== null && typeof categoriaId !== "string") {
      return invalidResponse("Seleccione una categoría válida", "categoriaId")
    }
    return masivaOverlay(
      tenantId,
      seleccion,
      { tipo: "categoria", categoriaId: categoriaId === "" ? null : categoriaId },
      updatedBy,
    )
  }
  if (accion.tipo === "tag") {
    if (typeof accion.tagId !== "string") return invalidResponse("Seleccione una etiqueta válida", "tagId")
    if (accion.modo !== "agregar" && accion.modo !== "quitar") {
      return invalidResponse("La acción sobre la etiqueta es inválida", "modo")
    }
    return masivaTags(tenantId, seleccion, accion.tagId, accion.modo, updatedBy)
  }
  return invalidResponse("La acción es inválida", "accion")
}
