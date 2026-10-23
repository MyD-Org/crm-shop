import { guardarDespacho, leerDespacho } from "@/lib/reglas-venta-repo"
import { NO_STORE, requireSucursalesAccess } from "@/lib/sucursales-respuestas"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"

// GET /api/admin/despacho — plazo de despacho que muestra el Shop (defaults si todavía no hay
// fila: visible, 1 día hábil = "24 h hábiles").
// PUT /api/admin/despacho — guarda la configuración COMPLETA (visible y días hábiles). Valida en
// servidor igual que el formulario. Tras persistir se avisa al Shop (best-effort): la respuesta
// trae `propagado`. Guard y tenant como /api/admin/envios.

export async function GET(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response
  return Response.json({ despacho: await leerDespacho(guard.tenantId) }, { headers: NO_STORE })
}

export async function PUT(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const r = await guardarDespacho(guard.tenantId, body)
  if (r.kind === "invalid") {
    return Response.json({ error: r.error, code: "invalid", campo: r.campo }, { status: 400, headers: NO_STORE })
  }

  const { propagado } = await pingShopRevalidarSucursales(guard.tenantId)
  return Response.json({ ok: true, propagado, despacho: r.despacho }, { headers: NO_STORE })
}
