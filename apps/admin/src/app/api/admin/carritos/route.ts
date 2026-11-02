import { requireAdminPlus } from "@/lib/admin-route-guard"
import {
  CARRITOS_Q_MAX,
  DIAS_ANTIGUEDAD,
  FILTROS_PEDIDO,
  HORAS_INACTIVIDAD,
  listarCarritosAbandonados,
} from "@/lib/carritos-repo"

// GET /api/admin/carritos?horas=&dias=&pedido=&q=&start=&limit= — carritos abandonados del tenant de la
// sesión (compradores con sesión, con ítems y sin actividad hace N horas), con monto referencial y la
// marca de pedido pendiente de pago en línea. Sólo lectura, solo admin y superadmin (requireAdminPlus).
// El tenant sale SÓLO del guard. Convención de /api/admin/pedidos: `{items,total}`, `start`/`limit`,
// errores `{error,code}`, nunca cacheable.

const NO_STORE = { "Cache-Control": "private, no-store" }

const invalid = (error: string) => Response.json({ error, code: "invalid" }, { status: 400, headers: NO_STORE })

/** Entero de una lista blanca: null = parámetro ausente (el repo aplica el default); undefined = inválido. */
function entero(valor: string | null, validos: readonly number[]): number | null | undefined {
  if (valor === null) return null
  const x = Number(valor)
  return valor !== "" && validos.includes(x) ? x : undefined
}

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const url = new URL(req.url)

  const horas = entero(url.searchParams.get("horas"), HORAS_INACTIVIDAD)
  if (horas === undefined) return invalid("El filtro de inactividad es inválido")
  const dias = entero(url.searchParams.get("dias"), DIAS_ANTIGUEDAD)
  if (dias === undefined) return invalid("El filtro de antigüedad es inválido")

  const pedidoParam = url.searchParams.get("pedido")
  const pedido = pedidoParam === null ? FILTROS_PEDIDO[0] : FILTROS_PEDIDO.find((p) => p === pedidoParam)
  if (!pedido) return invalid("El filtro de pedido es inválido")

  const q = (url.searchParams.get("q") ?? "").trim()
  if (q.length > CARRITOS_Q_MAX) return invalid("La búsqueda es demasiado larga")

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
    const resultado = await listarCarritosAbandonados(guard.tenantId, {
      horas: horas ?? undefined,
      dias: dias ?? undefined,
      pedido,
      q,
      start,
      limit,
    })
    return Response.json(resultado, { headers: NO_STORE })
  } catch (err) {
    // Falla ruidosa (500 + log), nunca una lista vacía que parezca "no hay carritos". Al log va sólo el
    // tenant, el nombre y el código del error: el mensaje de Postgres puede traer datos.
    const e = err as { name?: unknown; code?: unknown }
    console.error(
      `[admin/carritos] no se pudo listar tenant=${guard.tenantId} error=${String(e?.name ?? "Error")} codigo=${String(e?.code ?? "sin código")}`,
    )
    return Response.json(
      { error: "No se pudieron cargar los carritos abandonados. Inténtelo nuevamente.", code: "internal" },
      { status: 500, headers: NO_STORE },
    )
  }
}
