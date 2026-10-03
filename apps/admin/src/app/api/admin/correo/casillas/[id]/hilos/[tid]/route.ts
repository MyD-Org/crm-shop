import { adminNotFoundResponse } from "@/lib/admin-route-guard"
import { NO_STORE, errorJson, errorLectura } from "@/lib/correo-admin"
import { esIdResend, parsePatchHilo, requireCorreoLector } from "@/lib/correo-lectura"
import { marcarHilo } from "@/lib/correo-repo"
import { patchThread } from "@/lib/correo-resend"

type Params = { params: Promise<{ id: string; tid: string }> }

// PATCH /api/admin/correo/casillas/[id]/hilos/[tid] — { leido?, carpeta? }: marca leído/no leído
// y/o mueve de carpeta (inbox, archive, spam, trash). Aplica el cambio en Resend y luego en el
// espejo. Solo se puede MOVER a la papelera: no existe el borrado definitivo.
export async function PATCH(req: Request, { params }: Params) {
  const { id, tid } = await params
  const guard = await requireCorreoLector(req, id)
  if (!guard.ok) return guard.response
  if (!esIdResend(tid)) return adminNotFoundResponse()

  const parsed = parsePatchHilo(await req.json().catch(() => null))
  if (!parsed.ok) return errorJson(parsed.error, 400)
  const { leido, carpeta } = parsed.valor

  try {
    await patchThread(guard.casilla.resendInboxId, tid, {
      ...(leido !== undefined ? { read: leido } : {}),
      ...(carpeta !== undefined ? { folder: carpeta } : {}),
    })
  } catch (e) {
    return errorLectura(e)
  }
  // Resend ya aplicó el cambio: si falla el espejo no se le informa error a la persona; el
  // listado y el webhook lo reconcilian.
  await marcarHilo(guard.casilla.id, tid, { leido, carpeta }).catch(() =>
    console.error("[correo] no se pudo actualizar el espejo del hilo"),
  )
  return Response.json({ ok: true, ...(leido !== undefined ? { leido } : {}), ...(carpeta !== undefined ? { carpeta } : {}) }, { headers: NO_STORE })
}
