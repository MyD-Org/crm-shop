import { requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, conUrlDeFotos, invalidResponse, NO_STORE, validacionResponse } from "@/lib/catalogo-admin"
import { detalleProducto } from "@/lib/catalogo-overlay-repo"
import { quitarDelGrupo, sumarAGrupo, type ResultadoGrupoManual } from "@/lib/catalogo-variantes-repo"

// POST   /api/admin/catalogo/variantes — suma un producto suelto a un modelo (grupo armado a mano).
//        Cuerpo: { alegraId, grupoId, etiqueta, orden?, etiquetaAncla? }. `grupoId` es el modelo
//        elegido: un padre de Alegra, la base de un grupo manual, o un producto suelto que pasa a
//        ser la base de un grupo nuevo (en ese caso hace falta `etiquetaAncla`).
// DELETE /api/admin/catalogo/variantes — quita un producto de su grupo. Cuerpo: { alegraId }.
//
// Caso real: el "RGB" es otro producto de Alegra (otro precio) y en la tienda tiene que verse como
// una opción más del modelo. Las reglas (sólo productos sueltos, un solo grupo por producto, sin
// ciclos, un padre no se suma) están en `lib/catalogo-variantes-repo.ts`; acá se parsea, se
// responde y se avisa al Shop. Después de cada cambio el repo recalcula los grupos tocados.
//
// admin+ (operator → 404). Tenant = el del guard, siempre: un producto de otro tenant se comporta
// como uno inexistente.

const NO_ENCONTRADO = "No encontramos el producto. Actualice el listado e inténtelo nuevamente."

function responder(r: ResultadoGrupoManual): Response | null {
  if (r.kind === "invalid") return validacionResponse(r.error, r.campo)
  if (r.kind === "not_found") {
    return Response.json({ error: r.error || NO_ENCONTRADO, code: "not_found", campo: r.campo }, { status: 404, headers: NO_STORE })
  }
  return null
}

const texto = (v: unknown): string => (typeof v === "string" ? v : "")

async function modeloActualizado(tenantId: string, grupoId: string) {
  const producto = await detalleProducto(tenantId, grupoId)
  return producto ? conUrlDeFotos(producto) : null
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object") return invalidResponse("El cuerpo del pedido no es válido.", "body")
  if (body.orden !== undefined && typeof body.orden !== "number") {
    return validacionResponse("El orden debe ser un número entero.", "orden")
  }

  const r = await sumarAGrupo(
    guard.tenantId,
    {
      alegraId: texto(body.alegraId),
      grupoId: texto(body.grupoId),
      etiqueta: texto(body.etiqueta),
      ...(typeof body.orden === "number" ? { orden: body.orden } : {}),
      ...(body.etiquetaAncla !== undefined ? { etiquetaAncla: texto(body.etiquetaAncla) } : {}),
    },
    guard.user.id,
  )
  const error = responder(r)
  if (error) return error
  if (r.kind !== "ok") return invalidResponse("No se pudo sumar el producto al modelo.", "body")

  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado, producto: await modeloActualizado(guard.tenantId, r.grupoId) }, { status: 201, headers: NO_STORE })
}

export async function DELETE(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const alegraId = texto(body?.alegraId) || (new URL(req.url).searchParams.get("alegraId") ?? "")

  const r = await quitarDelGrupo(guard.tenantId, alegraId)
  const error = responder(r)
  if (error) return error
  if (r.kind !== "ok") return invalidResponse("No se pudo quitar el producto del modelo.", "body")

  const { propagado } = await avisarShop(guard.tenantId)
  // El modelo puede haberse disuelto (la base quedó sola): en ese caso sigue existiendo como producto suelto.
  return Response.json({ ok: true, propagado, producto: await modeloActualizado(guard.tenantId, r.grupoId) }, { headers: NO_STORE })
}
