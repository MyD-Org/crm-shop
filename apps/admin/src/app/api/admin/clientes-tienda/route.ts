import { requireOperatorPlus } from "@/lib/admin-route-guard"
import {
  CLIENTES_TIENDA_Q_MAX,
  FILTROS_ACCESO,
  FILTROS_PEDIDOS,
  FILTROS_VINCULO,
  listarClientesTienda,
} from "@/lib/clientes-tienda-repo"

// GET /api/admin/clientes-tienda?q=&vinculo=&acceso=&pedidos=&start=&limit= — usuarios
// registrados en la tienda del tenant de la sesión, con su vínculo, acceso a Facturación y
// pedidos. Sólo lectura, abierto desde OPERATOR (requireOperatorPlus). El tenant sale SÓLO del
// guard. Misma convención que /api/admin/pedidos: `{items,total}`, `start`/`limit`, errores
// `{error,code}`, nunca cacheable.

const NO_STORE = { "Cache-Control": "private, no-store" }

const invalid = (error: string) => Response.json({ error, code: "invalid" }, { status: 400, headers: NO_STORE })

/** null = parámetro ausente ⇒ "todos"; undefined = valor inválido. */
function filtro<T extends string>(valor: string | null, validos: readonly T[]): T | undefined {
  if (valor === null) return validos[0]
  return (validos as readonly string[]).includes(valor) ? (valor as T) : undefined
}

export async function GET(req: Request) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const url = new URL(req.url)

  const vinculo = filtro(url.searchParams.get("vinculo"), FILTROS_VINCULO)
  if (!vinculo) return invalid("El filtro de vínculo es inválido")
  const acceso = filtro(url.searchParams.get("acceso"), FILTROS_ACCESO)
  if (!acceso) return invalid("El filtro de acceso es inválido")
  const pedidos = filtro(url.searchParams.get("pedidos"), FILTROS_PEDIDOS)
  if (!pedidos) return invalid("El filtro de pedidos es inválido")

  const q = (url.searchParams.get("q") ?? "").trim()
  if (q.length > CLIENTES_TIENDA_Q_MAX) return invalid("La búsqueda es demasiado larga")

  const startParam = url.searchParams.get("start")
  const start = startParam === null ? 0 : Number(startParam)
  if (startParam === "" || !Number.isInteger(start) || start < 0) return invalid("La paginación es inválida")

  // Se acepta 1..100 (igual que pedidos); el repo acota el tamaño real de la página a 50.
  const limitParam = url.searchParams.get("limit")
  const limit = limitParam === null ? undefined : Number(limitParam)
  if (limit !== undefined && (limitParam === "" || !Number.isInteger(limit) || limit < 1 || limit > 100)) {
    return invalid("El límite es inválido")
  }

  try {
    const { items, total } = await listarClientesTienda(guard.tenantId, { q, vinculo, acceso, pedidos, start, limit })
    return Response.json({ items, total }, { headers: NO_STORE })
  } catch (err) {
    // Falla ruidosa (500 + log), nunca una lista vacía que parezca "no hay clientes". Al log va
    // sólo el tenant, el nombre y el código del error: el mensaje de Postgres puede traer datos.
    const e = err as { name?: unknown; code?: unknown }
    console.error(
      `[admin/clientes-tienda] no se pudo listar tenant=${guard.tenantId} error=${String(e?.name ?? "Error")} codigo=${String(e?.code ?? "sin código")}`,
    )
    return Response.json(
      { error: "No se pudieron cargar los clientes de la tienda. Inténtelo nuevamente.", code: "internal" },
      { status: 500, headers: NO_STORE },
    )
  }
}
