import { adminNotFoundResponse } from "@/lib/admin-route-guard"
import { NO_STORE, errorLectura } from "@/lib/correo-admin"
import { esIdResend, requireCorreoLector } from "@/lib/correo-lectura"
import { avisoDeEntrega, type AvisoEntrega } from "@/lib/correo-entrega"
import { getEmailLastEvent, listThreadEmails } from "@/lib/correo-resend"

const MAX_SALIENTES_CONSULTADOS = 10

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
    // Estado de entrega de los salientes, en vivo contra Resend (GET /emails/{id}, con cache
    // corto). Solo los últimos para respetar el rate limit; sin dato el hilo se muestra igual.
    const salientes = mensajes.filter((m) => m.direccion === "outbound").slice(-MAX_SALIENTES_CONSULTADOS)
    const entregas: Record<string, AvisoEntrega> = {}
    await Promise.all(
      salientes.map(async (m) => {
        const aviso = avisoDeEntrega(await getEmailLastEvent(m.id))
        if (aviso) entregas[m.id] = aviso
      }),
    )
    return Response.json({ ...hilo, mensajes, entregas }, { headers: NO_STORE })
  } catch (e) {
    return errorLectura(e)
  }
}
