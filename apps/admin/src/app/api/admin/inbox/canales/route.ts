import { requireAdminPlus, requireOperatorPlus } from "@/lib/admin-route-guard"
import { guardarNombres, listarNombres } from "@/lib/inbox-canales-repo"
import { parseNombresBody } from "@/lib/inbox-canales"

// GET /api/admin/inbox/canales — nombres que el admin le puso a cada canal del inbox
//   (cualquier operador: las solapas los muestran).
// PUT /api/admin/inbox/canales — guarda los nombres ({nombres: {clave: nombre}}, vacío = quitar).
//   Solo admin y superadmin. El tenant sale del guard, nunca del body.

const NO_STORE = { "Cache-Control": "private, no-store" }

export async function GET(req: Request) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response
  return Response.json({ nombres: await listarNombres(guard.tenantId) }, { headers: NO_STORE })
}

export async function PUT(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const parsed = parseNombresBody(await req.json().catch(() => null))
  if (!parsed.ok) return Response.json({ error: parsed.error, code: "invalid" }, { status: 400, headers: NO_STORE })

  await guardarNombres(guard.tenantId, parsed.nombres)
  return Response.json({ ok: true, nombres: await listarNombres(guard.tenantId) }, { headers: NO_STORE })
}
