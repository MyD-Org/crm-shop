import { requireAdminPlus } from "@/lib/admin-route-guard"
import { guardarCuentaDeSucursal } from "@/lib/alegra-cuentas-repo"
import { errorDeResultado, noEncontrado, NO_STORE } from "@/lib/sucursales-respuestas"

// PUT /api/admin/sucursales/[slug]/cuenta-alegra — asigna la cuenta de Alegra de la sucursal.
// Cuerpo: { modo: "ninguna" | "principal" | "propia", cuit?, email?, token?, nombre? }.
// El token es write-only (vacío al editar = conservar el guardado) y no vuelve en la respuesta.
// Admin o superadmin. Tenant = el del guard. El Shop no lee estas tablas: no hay nada que avisarle.

type Ctx = { params: Promise<{ slug: string }> }

export async function PUT(req: Request, { params }: Ctx) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { slug } = await params
  const body = await req.json().catch(() => null)
  const r = await guardarCuentaDeSucursal(guard.tenantId, slug, body)
  if (r.kind === "not_found") return noEncontrado()
  if (r.kind !== "ok") return errorDeResultado(r)
  return Response.json({ ok: true, cuenta: r.cuenta }, { headers: NO_STORE })
}
