import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, invalidResponse, NO_STORE } from "@/lib/catalogo-admin"
import { esUuid, moverDestacado } from "@/lib/catalogo-overlay-repo"

// POST /api/admin/catalogo/productos/destacados/mover
//
// Body: { categoriaId, alegraId, direccion: "subir" | "bajar" }
//
// Sube o baja un producto destacado una posición dentro de los destacados de la categoría
// (subárbol incluido) y renumera 1..N en una sola transacción. El servidor resuelve el conjunto:
// el cliente no manda la lista, así que una pantalla vieja no puede pisar un orden más nuevo.
// Un producto que no está destacado en esa categoría de ESTE tenant es el mismo 404 de siempre.

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  if (!esObjeto(body)) return invalidResponse("Los datos son inválidos")
  const { categoriaId, alegraId, direccion } = body
  if (typeof categoriaId !== "string" || !esUuid(categoriaId)) {
    return invalidResponse("Seleccione una categoría válida", "categoriaId")
  }
  if (typeof alegraId !== "string" || alegraId === "") return invalidResponse("Seleccione un producto", "alegraId")
  if (direccion !== "subir" && direccion !== "bajar") return invalidResponse("La dirección es inválida", "direccion")

  const r = await moverDestacado(guard.tenantId, categoriaId, alegraId, direccion, guard.user.id)
  if (r.kind === "not_found") return adminNotFoundResponse()

  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado }, { headers: NO_STORE })
}
