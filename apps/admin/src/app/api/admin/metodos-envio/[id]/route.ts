import { eliminarMetodo, guardarMetodo } from "@/lib/metodos-envio-repo"
import { errorDeResultadoMetodo, prepararMetodo } from "@/lib/metodos-envio-guardado"
import { pingShopRevalidarSucursales } from "@/lib/shop-revalidar"
import { noEncontrado, NO_STORE, requireSucursalesAccess } from "@/lib/sucursales-respuestas"

// PUT    /api/admin/metodos-envio/[id] — guarda el método COMPLETO (datos, zonas, geometrías, entradas
//        y localidades) en una transacción. Avisa al Shop.
// DELETE /api/admin/metodos-envio/[id] — sólo si está inactivo.

type Ctx = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PUT(req: Request, { params }: Ctx) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  if (!UUID.test(id)) return noEncontrado()
  const body = await req.json().catch(() => null)
  const p = await prepararMetodo(body)
  if (!p.ok) return p.response

  const r = await guardarMetodo(guard.tenantId, id.toLowerCase(), p.metodo)
  if (r.kind !== "ok") return errorDeResultadoMetodo(r)

  const { propagado } = await pingShopRevalidarSucursales(guard.tenantId)
  return Response.json({ ok: true, propagado, metodo: r.metodo, avisos: p.avisos }, { headers: NO_STORE })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const guard = await requireSucursalesAccess(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  if (!UUID.test(id)) return noEncontrado()
  const r = await eliminarMetodo(guard.tenantId, id.toLowerCase())
  if (r.kind === "not_found") return noEncontrado()
  if (r.kind === "conflict") {
    return Response.json({ error: r.error, code: "conflict" }, { status: 409, headers: NO_STORE })
  }

  const { propagado } = await pingShopRevalidarSucursales(guard.tenantId)
  return Response.json({ ok: true, propagado }, { headers: NO_STORE })
}
