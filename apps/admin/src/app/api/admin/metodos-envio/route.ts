import { crearMetodo, listarMetodos } from "@/lib/metodos-envio-repo"
import { errorDeResultadoMetodo, prepararMetodo } from "@/lib/metodos-envio-guardado"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"
import { NO_STORE, requireSucursalesAccess } from "@/lib/sucursales-respuestas"

// GET  /api/admin/metodos-envio — métodos de envío por zona del tenant (con zonas, geometrías,
//      entradas y localidades atendidas).
// POST /api/admin/metodos-envio — crea un método. Valida en servidor (mensajes en usted), completa
//      centro/rectángulo de las localidades y avisa al Shop (best-effort: `propagado`).
// Mismo guard que el resto de Envíos (operador o superior); tenant = el del guard.

export async function GET(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response
  return Response.json({ metodos: await listarMetodos(guard.tenantId) }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const p = await prepararMetodo(body)
  if (!p.ok) return p.response

  const r = await crearMetodo(guard.tenantId, p.metodo)
  if (r.kind !== "ok") return errorDeResultadoMetodo(r)

  const { propagado } = await pingShopRevalidarSucursales(guard.tenantId)
  return Response.json({ ok: true, propagado, metodo: r.metodo, avisos: p.avisos }, { status: 201, headers: NO_STORE })
}
