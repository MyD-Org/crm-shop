import { requireAdminPlus } from "@/lib/admin-route-guard"
import { configDeSucursal } from "@/lib/alegra-cuentas-repo"
import { probarConexionAlegra } from "@/lib/alegra"
import { noEncontrado, NO_STORE } from "@/lib/sucursales-respuestas"

// POST /api/admin/sucursales/[slug]/cuenta-alegra/probar — prueba de conexión con UNA llamada de
// solo lectura a Alegra. Sin cuerpo prueba la cuenta guardada; con `email` y/o `token` prueba esas
// credenciales sin guardarlas (lo que falte se completa con lo guardado). Nunca devuelve el token
// ni el detalle crudo de Alegra. Admin o superadmin.

type Ctx = { params: Promise<{ slug: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { slug } = await params
  const body = (await req.json().catch(() => null)) as { email?: unknown; token?: unknown } | null
  const email = typeof body?.email === "string" ? body.email.trim() : undefined
  const token = typeof body?.token === "string" ? body.token.trim() : undefined

  const c = await configDeSucursal(guard.tenantId, slug, { email, token })
  if (c.kind === "not_found") return noEncontrado()
  if (c.kind === "sin_cuenta") {
    return Response.json({ ok: false, motivo: "sin_cuenta", mensaje: c.error }, { headers: NO_STORE })
  }
  const r = await probarConexionAlegra(c.config)
  return Response.json(r, { headers: NO_STORE })
}
