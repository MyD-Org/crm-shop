import { requireAdminPlus } from "@/lib/admin-route-guard"
import { FILTROS_AVISOS, listarDemandaReingreso, listarInteresadosDe } from "@/lib/avisos-reingreso-repo"

// GET /api/admin/avisos-reingreso?filtro=&start=&limit= — demanda de "Avisarme cuando ingrese" agrupada por
// producto (avisos pendientes del tenant de la sesión).
// GET /api/admin/avisos-reingreso?producto=<alegraId> — las personas que esperan ese producto.
// Sólo lectura, solo admin y superadmin (requireAdminPlus). El tenant sale SÓLO del guard.
// Convención de /api/admin/carritos: `{items,total}`, errores `{error,code}`, nunca cacheable.

const NO_STORE = { "Cache-Control": "private, no-store" }

const invalid = (error: string) => Response.json({ error, code: "invalid" }, { status: 400, headers: NO_STORE })

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const url = new URL(req.url)
  const producto = url.searchParams.get("producto")

  try {
    if (producto !== null) {
      if (producto === "" || producto.length > 64) return invalid("El producto es inválido")
      const items = await listarInteresadosDe(guard.tenantId, producto)
      return Response.json({ items }, { headers: NO_STORE })
    }

    const filtroParam = url.searchParams.get("filtro")
    const filtro = filtroParam === null ? FILTROS_AVISOS[0] : FILTROS_AVISOS.find((p) => p === filtroParam)
    if (!filtro) return invalid("El filtro es inválido")

    const startParam = url.searchParams.get("start")
    const start = startParam === null ? 0 : Number(startParam)
    if (startParam === "" || !Number.isInteger(start) || start < 0) return invalid("La paginación es inválida")

    const limitParam = url.searchParams.get("limit")
    const limit = limitParam === null ? undefined : Number(limitParam)
    if (limit !== undefined && (limitParam === "" || !Number.isInteger(limit) || limit < 1 || limit > 100)) {
      return invalid("El límite es inválido")
    }

    return Response.json(await listarDemandaReingreso(guard.tenantId, { filtro, start, limit }), { headers: NO_STORE })
  } catch (err) {
    // Falla ruidosa (500 + log), nunca una lista vacía que parezca "no hay demanda". Al log va sólo el
    // tenant, el nombre y el código del error: el mensaje de Postgres puede traer datos.
    const e = err as { name?: unknown; code?: unknown }
    console.error(
      `[admin/avisos-reingreso] no se pudo listar tenant=${guard.tenantId} error=${String(e?.name ?? "Error")} codigo=${String(e?.code ?? "sin código")}`,
    )
    return Response.json(
      { error: "No se pudieron cargar los avisos de stock. Inténtelo nuevamente.", code: "internal" },
      { status: 500, headers: NO_STORE },
    )
  }
}
