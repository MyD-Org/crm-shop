import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { invalidResponse } from "@/lib/catalogo-admin"
import { generarLote, LOTE_MAX } from "@/lib/cupones-repo"
import { esUuid } from "@/lib/precios-online-cambios"
import { NO_STORE, leerJson, respuestaDeError } from "@/lib/precios-online-http"

// POST /api/admin/cupones/[id]/lote — { cantidad } (1..500) -> text/csv con los códigos nuevos.
// 422 `solo_unicos` si la promoción es genérica. admin+ (operator -> 404).

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!esUuid(id)) return adminNotFoundResponse()
  const body = await leerJson(req)
  if (body instanceof Response) return body
  const { cantidad } = body
  if (typeof cantidad !== "number" || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > LOTE_MAX) {
    return invalidResponse(`Indique una cantidad entera entre 1 y ${LOTE_MAX}.`, "cantidad")
  }
  try {
    const codigos = await generarLote(guard.tenantId, id, cantidad, guard.user)
    return new Response(["codigo", ...codigos].join("\n") + "\n", {
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cupones-${id.slice(0, 8)}.csv"`,
      },
    })
  } catch (err) {
    return respuestaDeError(err)
  }
}
