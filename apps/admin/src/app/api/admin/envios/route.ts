import { guardarEnvio, leerEnvio } from "@/lib/reglas-venta-repo"
import { NO_STORE, requireSucursalesAccess } from "@/lib/sucursales-respuestas"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"

// GET /api/admin/envios — configuración de envío del tenant (defaults si todavía no hay fila:
// domicilio activo, envío gratis apagado).
// PUT /api/admin/envios — guarda la configuración COMPLETA (domicilio, gratis, alcance, provincias,
// mínimo). Valida en servidor igual que el formulario. Rige para los pedidos NUEVOS. Tras persistir
// se avisa al Shop (best-effort): la respuesta trae `propagado`.
// Guard como /api/admin/reglas-venta (operador o superior; la página, en cambio, es admin+);
// tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response
  return Response.json({ envio: await leerEnvio(guard.tenantId) }, { headers: NO_STORE })
}

export async function PUT(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const r = await guardarEnvio(guard.tenantId, body)
  if (r.kind === "invalid") {
    return Response.json({ error: r.error, code: "invalid", campo: r.campo }, { status: 400, headers: NO_STORE })
  }

  const { propagado } = await pingShopRevalidarSucursales()
  return Response.json({ ok: true, propagado, envio: r.envio }, { headers: NO_STORE })
}
