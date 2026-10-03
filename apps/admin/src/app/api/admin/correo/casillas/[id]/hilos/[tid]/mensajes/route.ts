import { adminNotFoundResponse } from "@/lib/admin-route-guard"
import { NO_STORE, errorLectura } from "@/lib/correo-admin"
import { esIdResend, requireCorreoLector } from "@/lib/correo-lectura"
import { listThreadEmails } from "@/lib/correo-resend"

type Params = { params: Promise<{ id: string; tid: string }> }

// GET /api/admin/correo/casillas/[id]/hilos/[tid]/mensajes — metadatos de los mensajes del hilo,
// en orden cronológico, SIN cuerpos (cada cuerpo se pide aparte) y sin URLs de adjuntos (la
// descarga pasa por /api/admin/correo/adjuntos, que verifica el acceso en cada clic).
export async function GET(req: Request, { params }: Params) {
  const { id, tid } = await params
  const guard = await requireCorreoLector(req, id)
  if (!guard.ok) return guard.response
  if (!esIdResend(tid)) return adminNotFoundResponse()

  try {
    const hilo = await listThreadEmails(guard.casilla.resendInboxId, tid)
    const mensajes = [...hilo.mensajes].sort((a, b) => a.recibidoEn.localeCompare(b.recibidoEn))
    return Response.json({ ...hilo, mensajes }, { headers: NO_STORE })
  } catch (e) {
    return errorLectura(e)
  }
}
