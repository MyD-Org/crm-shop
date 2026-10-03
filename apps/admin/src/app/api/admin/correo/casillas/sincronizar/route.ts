import { NO_STORE, requireCorreoAdmin, respuestaErrorResend, vistaCasillas } from "@/lib/correo-admin"
import { upsertCasilla } from "@/lib/correo-repo"
import { listInboxes } from "@/lib/correo-resend"

// POST /api/admin/correo/casillas/sincronizar — trae las inboxes de Resend y da de alta las que
// todavía no están, INACTIVAS (el admin decide cuáles activar), con el nombre que tienen en Resend.
// Las que ya existen refrescan el email y completan el nombre solo si sigue siendo el de relleno
// (== email); un nombre editado, activa y orden no se pisan. Devuelve la misma vista que el GET.
export async function POST(req: Request) {
  const guard = await requireCorreoAdmin(req)
  if (!guard.ok) return guard.response
  try {
    const inboxes = await listInboxes()
    for (const i of inboxes) {
      if (!i.id || !i.email) continue
      await upsertCasilla(guard.tenantId, { resendInboxId: i.id, email: i.email, nombre: i.nombre || undefined, activa: false })
    }
  } catch (e) {
    return respuestaErrorResend(e)
  }
  return Response.json(await vistaCasillas(guard.tenantId), { headers: NO_STORE })
}
