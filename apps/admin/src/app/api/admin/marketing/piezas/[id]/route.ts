import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { crearSolicitud } from "@/lib/marketing/otros-repo"
import { pingStudio } from "@/lib/marketing/ping-studio"
import { editarContenido, eventosDePieza, obtenerPieza, transicionar, type ResultadoTransicion } from "@/lib/marketing/piezas-repo"

export const dynamic = "force-dynamic"
type Ctx = { params: Promise<{ id: string }> }

const MENSAJES: Record<string, string> = {
  invalid_transition: "La pieza no puede pasar a ese estado desde el estado actual",
  conflict: "La pieza cambió mientras la editaba. Recargue la página e inténtelo de nuevo",
}

function respuesta(r: ResultadoTransicion): Response {
  if (r.ok) return Response.json(r.pieza, { headers: NO_STORE })
  if (r.code === "not_found") return adminNotFoundResponse()
  return Response.json({ error: MENSAJES[r.code], code: r.code }, { status: 409, headers: NO_STORE })
}

export async function GET(req: Request, ctx: Ctx) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  const pieza = await obtenerPieza(guard.tenantId, id)
  if (!pieza) return adminNotFoundResponse()
  return Response.json({ pieza, eventos: await eventosDePieza(guard.tenantId, id) }, { headers: NO_STORE })
}

export async function PATCH(req: Request, ctx: Ctx) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const accion = b?.accion
  const nombre = guard.user.name
  const nota = typeof b?.nota === "string" ? b.nota.trim().slice(0, 1000) : ""

  switch (accion) {
    case "aprobar":
      return respuesta(await transicionar(guard.tenantId, id, "aprobada", "usuario", { nombreActor: nombre }))
    case "descartar":
      return respuesta(await transicionar(guard.tenantId, id, "descartada", "usuario", { nombreActor: nombre, nota }))
    case "pedir_cambios": {
      if (!nota) return Response.json({ error: "Indique qué cambios necesita", code: "missing_nota" }, { status: 400, headers: NO_STORE })
      const r = await transicionar(guard.tenantId, id, "cambios_pedidos", "usuario", { nombreActor: nombre, nota })
      if (r.ok) await crearSolicitud(guard.tenantId, "cambios", { piezaId: id, nota })
      return respuesta(r)
    }
    case "marcar_publicada": {
      const permalink = typeof b?.permalink === "string" ? b.permalink.trim() : ""
      if (permalink && !/^https:\/\//.test(permalink)) return Response.json({ error: "El enlace debe empezar con https://", code: "invalid_permalink" }, { status: 400, headers: NO_STORE })
      return respuesta(await transicionar(guard.tenantId, id, "publicada", "usuario", { nombreActor: nombre, campos: permalink ? { permalink } : {} }))
    }
    case "editar": {
      const contenido = b?.contenido
      if (contenido !== undefined && (typeof contenido !== "object" || contenido === null || Array.isArray(contenido))) {
        return Response.json({ error: "El contenido debe ser un objeto JSON", code: "invalid_contenido" }, { status: 400, headers: NO_STORE })
      }
      const r = await editarContenido(
        guard.tenantId,
        id,
        {
          contenido: contenido as Record<string, unknown> | undefined,
          caption: typeof b?.caption === "string" ? b.caption.slice(0, 2200) : undefined,
          hashtags: Array.isArray(b?.hashtags) ? b.hashtags.map(String).slice(0, 30) : undefined,
        },
        nombre,
      )
      if (r.ok && r.pieza.estado === "borrador") await pingStudio()
      return respuesta(r)
    }
    default:
      return Response.json({ error: "Acción desconocida", code: "invalid_accion" }, { status: 400, headers: NO_STORE })
  }
}
