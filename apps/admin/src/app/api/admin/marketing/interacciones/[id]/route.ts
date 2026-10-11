import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { actualizarInteraccion, obtenerInteraccion } from "@/lib/marketing/otros-repo"

export const dynamic = "force-dynamic"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const b = (await req.json().catch(() => null)) as { accion?: unknown; respuesta?: unknown } | null
  if (b?.accion !== "aprobar" && b?.accion !== "ocultar" && b?.accion !== "ignorar") {
    return Response.json({ error: "Acción desconocida", code: "invalid_accion" }, { status: 400, headers: NO_STORE })
  }
  const { id } = await ctx.params
  const respuesta = typeof b.respuesta === "string" ? b.respuesta.slice(0, 2000) : undefined
  if (b.accion === "aprobar" && !respuesta?.trim()) {
    // Sin texto propio se envía la respuesta sugerida: si tampoco hay, no hay nada que aprobar.
    // (Si la interacción no existe, sigue el camino normal y responde 404.)
    const actual = await obtenerInteraccion(guard.tenantId, id)
    if (actual && !actual.respuestaSugerida.trim()) {
      return Response.json({ error: "Escriba una respuesta antes de aprobar", code: "empty_reply" }, { status: 400, headers: NO_STORE })
    }
  }
  const i = await actualizarInteraccion(guard.tenantId, id, b.accion, respuesta)
  if (i) return Response.json(i, { headers: NO_STORE })
  // null = no existe (o es de otro tenant) o su estado ya no admite la acción.
  if (!(await obtenerInteraccion(guard.tenantId, id))) return adminNotFoundResponse()
  return Response.json({ error: "Este comentario ya fue tratado", code: "invalid_state" }, { status: 409, headers: NO_STORE })
}
