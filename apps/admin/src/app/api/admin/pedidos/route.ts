import { requireOperatorPlus } from "@/lib/admin-route-guard"
import { listarPedidos, TABLERO_MAX_LIMIT, toPedidoDto, type Cola } from "@/lib/pedidos-repo"
import { esEstadoPedido, type EstadoPedido } from "@/lib/pedidos-transiciones"

// GET /api/admin/pedidos?estado=&q=&entrega=&pago=&cola=&start=&limit=&vista= — pedidos del Shop
// del tenant de la sesión. Abierto desde OPERATOR (requireOperatorPlus). El tenant sale SÓLO
// del guard: cualquier `tenantId` que venga en la query se ignora.
//
// `colas` viaja SIEMPRE en la respuesta (una foto sin los filtros de arriba: "cuánto falta" en
// cada cola, no cuánto hay en la página actual). `vista=tablero` cambia el modo de paginación
// (sin start/limit, tope fijo) pero combina con los demás filtros si vienen.
//
// Misma convención que /api/admin/comprobantes: `{items,total}`, errores `{error,code}`, nunca
// cacheable.

const NO_STORE = { "Cache-Control": "private, no-store" }
const Q_MAX = 120

const ENTREGA_TIPOS = ["retiro", "envio"] as const
const PAGO_ESTADOS = ["pagado", "pendiente"] as const
const COLAS = ["sin_confirmar", "pago", "datos", "sin_factura"] as const

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

  const qParam = url.searchParams.get("q")
  const q = qParam === null ? undefined : qParam.trim()
  if (q !== undefined && q.length > Q_MAX) return invalid("La búsqueda es demasiado larga")

  const entregaParam = url.searchParams.get("entrega")
  if (entregaParam !== null && !(ENTREGA_TIPOS as readonly string[]).includes(entregaParam)) {
    return invalid("El filtro de entrega es inválido")
  }
  const entrega = (entregaParam as (typeof ENTREGA_TIPOS)[number] | null) ?? undefined

  const pagoParam = url.searchParams.get("pago")
  if (pagoParam !== null && !(PAGO_ESTADOS as readonly string[]).includes(pagoParam)) {
    return invalid("El filtro de pago es inválido")
  }
  const pago = (pagoParam as (typeof PAGO_ESTADOS)[number] | null) ?? undefined

  const colaParam = url.searchParams.get("cola")
  if (colaParam !== null && !(COLAS as readonly string[]).includes(colaParam)) {
    return invalid("La cola indicada no es válida")
  }
  const cola = (colaParam as Cola | null) ?? undefined

  const vistaParam = url.searchParams.get("vista")
  if (vistaParam !== null && vistaParam !== "tablero") return invalid("La vista indicada no es válida")
  const vista = vistaParam === "tablero" ? ("tablero" as const) : undefined

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
    const { items, total, colas } = await listarPedidos(guard.tenantId, {
      estado,
      q,
      entrega,
      pago,
      cola,
      start,
      limit: vista === "tablero" ? TABLERO_MAX_LIMIT : limit,
      vista,
    })
    return Response.json({ items: items.map(toPedidoDto), total, colas }, { headers: NO_STORE })
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
