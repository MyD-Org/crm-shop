import { adminNotFoundResponse } from "@/lib/admin-route-guard"
import { errorLectura } from "@/lib/correo-admin"
import { prepararCuerpo } from "@/lib/correo-html"
import { esIdResend, requireCorreoLector } from "@/lib/correo-lectura"
import { getThreadEmail } from "@/lib/correo-resend"

type Params = { params: Promise<{ id: string; tid: string; eid: string }> }

// GET .../hilos/[tid]/mensajes/[eid] — cuerpo de UN mensaje, ya saneado en el servidor (ver
// lib/correo-html.ts). Devuelve el HTML saneado (imágenes remotas bloqueadas en `data-src`) y
// cuántas imágenes remotas se bloquearon. Cache privado de 5 min: abrir y volver a abrir el
// mismo mensaje no vuelve a pegarle a Resend (10 req/s por cuenta, compartidos).
export async function GET(req: Request, { params }: Params) {
  const { id, tid, eid } = await params
  const guard = await requireCorreoLector(req, id)
  if (!guard.ok) return guard.response
  if (!esIdResend(tid) || !esIdResend(eid)) return adminNotFoundResponse()

  try {
    const m = await getThreadEmail(guard.casilla.resendInboxId, tid, eid)
    const cuerpo = prepararCuerpo({ html: m.html, texto: m.texto })
    return Response.json(
      { id: m.id, html: cuerpo.html, imagenesRemotas: cuerpo.imagenesRemotas },
      { headers: { "Cache-Control": "private, max-age=300" } },
    )
  } catch (e) {
    return errorLectura(e)
  }
}
