import { NO_STORE, requireCorreoAdmin, vistaCasillas } from "@/lib/correo-admin"

// GET /api/admin/correo/casillas — casillas del tenant con sus accesos y los operadores que se
// pueden tildar. Solo admin y superadmin, con el flag `correo` prendido (si no, 404). El tenant
// sale del guard. No devuelve ids internos de Resend.
export async function GET(req: Request) {
  const guard = await requireCorreoAdmin(req)
  if (!guard.ok) return guard.response
  return Response.json(await vistaCasillas(guard.tenantId), { headers: NO_STORE })
}
