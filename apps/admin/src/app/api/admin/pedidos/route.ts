import { requireOperatorPlus } from "@/lib/admin-route-guard"
import { listarPedidos, toPedidoDto } from "@/lib/pedidos-repo"
import { esEstadoPedido, type EstadoPedido } from "@/lib/pedidos-transiciones"

// GET /api/admin/pedidos?estado=&start=&limit= — pedidos del Shop del tenant de la sesión.
// Abierto desde OPERATOR (requireOperatorPlus). El tenant sale SÓLO del guard: cualquier
// `tenantId` que venga en la query se ignora. Misma convención que /api/admin/comprobantes:
// `{items,total}`, `start`/`limit`, errores `{error,code}`, nunca cacheable.

const NO_STORE = { "Cache-Control": "private, no-store" }

const invalid = (error: string) => Response.json({ error, code: "invalid" }, { status: 400, headers: NO_STORE })

export async function GET(req: Request) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const url = new URL(req.url)

  const estadoParam = url.searchParams.get("estado")
  let estado: EstadoPedido | "todos" = "todos"
  if (estadoParam !== null && estadoParam !== "todos") {
    if (!esEstadoPedido(estadoParam)) return invalid("El filtro de estado es inválido")
    estado = estadoParam
  }

  const startParam = url.searchParams.get("start")
  const start = startParam === null ? 0 : Number(startParam)
  if (startParam === "" || !Number.isInteger(start) || start < 0) return invalid("La paginación es inválida")

  // Se acepta 1..100 (igual que comprobantes); el repo acota el tamaño real de la página.
  const limitParam = url.searchParams.get("limit")
  const limit = limitParam === null ? undefined : Number(limitParam)
  if (limit !== undefined && (limitParam === "" || !Number.isInteger(limit) || limit < 1 || limit > 100)) {
    return invalid("El límite es inválido")
  }

  try {
    const { items, total } = await listarPedidos(guard.tenantId, { estado, start, limit })
    return Response.json({ items: items.map(toPedidoDto), total }, { headers: NO_STORE })
  } catch (err) {
    // Caso típico: el esquema `shop` todavía no existe en esta base. Tiene que fallar RUIDOSO
    // (500 + log), no contestar una lista vacía que parezca "no hay pedidos". El detalle
    // técnico va al log, nunca al body.
    console.error("[admin/pedidos] no se pudo listar", { tenant: guard.tenantId, err })
    return Response.json(
      { error: "No se pudieron cargar los pedidos. Inténtelo nuevamente.", code: "internal" },
      { status: 500, headers: NO_STORE },
    )
  }
}
