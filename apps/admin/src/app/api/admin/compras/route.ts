import { requireSeccion } from "@/lib/admin-route-guard"
import { cuentaActivaPorSlug } from "@/lib/compras-config-repo"
import { ESTADOS_COMPRA, type EstadoCompra } from "@/lib/compras-estado"
import { fail, ok, responderError, toCompraListaDto } from "@/lib/compras-http"
import { listarCompras } from "@/lib/compras-repo"
import { crearCompraDesdeBody } from "@/lib/compras-service"

// GET  /api/admin/compras — listado (filtros: estado, cuenta=<slug>, q, pagina).
// POST /api/admin/compras — crea la compra (factura del proveedor) y su bill de tránsito en Alegra.
//
// Todo detrás de `requireSeccion` (rol «compras», admin o superadmin + flag `compras-en-transito`;
// con el flag apagado responde 404 sin tocar Alegra). El tenant sale SIEMPRE del guard.

const PAGINA = 25

export async function GET(req: Request) {
  const guard = await requireSeccion(req, "compras")
  if (!guard.ok) return guard.response

  const url = new URL(req.url)
  const estado = url.searchParams.get("estado") ?? ""
  if (estado && !(ESTADOS_COMPRA as readonly string[]).includes(estado)) {
    return fail(400, "validacion", "El estado indicado no es válido.")
  }
  const slug = url.searchParams.get("cuenta")?.trim()
  let cuentaId: string | undefined
  if (slug) {
    const cuenta = await cuentaActivaPorSlug(guard.tenantId, slug)
    if (!cuenta) return ok({ items: [], hayMas: false })
    cuentaId = cuenta.id
  }
  const pagina = Math.max(Number.parseInt(url.searchParams.get("pagina") ?? "1", 10) || 1, 1)
  try {
    const filas = await listarCompras(guard.tenantId, {
      estado: (estado || undefined) as EstadoCompra | undefined,
      cuentaId,
      q: url.searchParams.get("q") ?? undefined,
      limit: PAGINA + 1,
      offset: (pagina - 1) * PAGINA,
    })
    return ok({ items: filas.slice(0, PAGINA).map(toCompraListaDto), hayMas: filas.length > PAGINA })
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId })
  }
}

export async function POST(req: Request) {
  const guard = await requireSeccion(req, "compras")
  if (!guard.ok) return guard.response

  const body: unknown = await req.json().catch(() => null)
  try {
    const r = await crearCompraDesdeBody(guard.tenantId, guard.user.id, body)
    return ok(r, r.incierta ? 202 : 201)
  } catch (err) {
    return responderError(err, { tenant: guard.tenantId })
  }
}
