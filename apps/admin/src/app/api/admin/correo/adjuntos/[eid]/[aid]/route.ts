import { adminNotFoundResponse } from "@/lib/admin-route-guard"
import { errorJson, errorLectura } from "@/lib/correo-admin"
import { ADJUNTO_MAX_BYTES, esIdResend, requireCorreoLector } from "@/lib/correo-lectura"
import { getAttachmentDownloadUrl, getThreadEmail } from "@/lib/correo-resend"

type Params = { params: Promise<{ eid: string; aid: string }> }

// GET /api/admin/correo/adjuntos/[eid]/[aid]?casilla=ID&hilo=ID — descarga de un adjunto recibido.
//
// Verifica sesión, flag y acceso a la casilla; comprueba que el mensaje `eid` pertenece de verdad
// a esa casilla/hilo (el endpoint de adjuntos de Resend es global a la cuenta: sin esto, quien
// tiene acceso a UNA casilla podría pedir adjuntos de otra adivinando ids); resuelve la URL
// firmada (~1 h) EN ESE MOMENTO y responde 302 a ella con no-store. La URL nunca se persiste ni
// viaja en un JSON: el contenido ajeno se sirve desde el dominio de Resend, no desde el nuestro.
export async function GET(req: Request, { params }: Params) {
  const { eid, aid } = await params
  const url = new URL(req.url)
  const guard = await requireCorreoLector(req, url.searchParams.get("casilla") ?? "")
  if (!guard.ok) return guard.response
  const hilo = url.searchParams.get("hilo") ?? ""
  if (!esIdResend(eid) || !esIdResend(aid) || !esIdResend(hilo)) return adminNotFoundResponse()

  try {
    const mensaje = await getThreadEmail(guard.casilla.resendInboxId, hilo, eid)
    if (mensaje.id !== eid) return adminNotFoundResponse()
    // Si el listado trae los adjuntos del mensaje, el pedido debe ser de uno de ellos.
    if (mensaje.adjuntos.length > 0 && !mensaje.adjuntos.some((a) => a.id === aid)) return adminNotFoundResponse()

    const adjunto = await getAttachmentDownloadUrl(eid, aid)
    if (adjunto.tamano > ADJUNTO_MAX_BYTES) return errorJson("El adjunto supera el tamaño máximo descargable (40 MB).", 413, "demasiado_grande")
    if (!/^https:\/\//i.test(adjunto.url)) return adminNotFoundResponse()
    return new Response(null, { status: 302, headers: { Location: adjunto.url, "Cache-Control": "private, no-store" } })
  } catch (e) {
    return errorLectura(e)
  }
}
