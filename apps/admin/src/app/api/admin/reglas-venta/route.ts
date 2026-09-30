import { guardarReglasVenta, leerReglasVenta } from "@/lib/reglas-venta-repo"
import { NO_STORE, requireSucursalesAccess } from "@/lib/sucursales-respuestas"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"

// GET /api/admin/reglas-venta — reglas de venta del tenant (defaults si todavía no hay fila).
// PUT /api/admin/reglas-venta — cambio parcial de las reglas. Rigen para los pedidos NUEVOS.
// Tras persistir se avisa al Shop (best-effort): la respuesta trae `propagado`.
// Operador o superior; tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response
  return Response.json({ reglas: await leerReglasVenta(guard.tenantId) }, { headers: NO_STORE })
}

export async function PUT(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const r = await guardarReglasVenta(guard.tenantId, body)
  if (r.kind === "invalid") {
    return Response.json({ error: r.error, code: "invalid", campo: r.campo }, { status: 400, headers: NO_STORE })
  }

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado, reglas: r.reglas }, { headers: NO_STORE })
}
