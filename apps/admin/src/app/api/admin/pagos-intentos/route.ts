import { requireAdminPlus } from "@/lib/admin-route-guard"
import {
  CUENTA_RE,
  DIAS_VENTANA,
  FILTROS_CLASE,
  FILTROS_PROVEEDOR,
  INTENTOS_Q_MAX,
  listarIntentos,
} from "@/lib/pagos-intentos-repo"

// GET /api/admin/pagos-intentos?dias=&proveedor=&cuenta=&clase=&q=&start=&limit= — intentos de cobro
// en línea del tenant de la sesión (más los pedidos por transferencia/efectivo, que no tienen intento),
// con la causa de la falla. Sólo lectura, solo admin y superadmin (requireAdminPlus): `error_proveedor`
// es diagnóstico interno. El tenant sale SÓLO del guard. Convención de /api/admin/pedidos:
// `{items,total}`, `start`/`limit`, errores `{error,code}`, nunca cacheable.

const NO_STORE = { "Cache-Control": "private, no-store" }

const invalid = (error: string) => Response.json({ error, code: "invalid" }, { status: 400, headers: NO_STORE })

/** null = parámetro ausente ⇒ primer valor; undefined = valor inválido. */
function filtro<T extends string>(valor: string | null, validos: readonly T[]): T | undefined {
  if (valor === null) return validos[0]
  return (validos as readonly string[]).includes(valor) ? (valor as T) : undefined
}

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const url = new URL(req.url)

  const diasParam = url.searchParams.get("dias")
  const dias = diasParam === null ? 7 : Number(diasParam)
  if (!(DIAS_VENTANA as readonly number[]).includes(dias)) return invalid("El período es inválido")
  const proveedor = filtro(url.searchParams.get("proveedor"), FILTROS_PROVEEDOR)
  if (!proveedor) return invalid("El filtro de proveedor es inválido")
  const clase = filtro(url.searchParams.get("clase"), FILTROS_CLASE)
  if (!clase) return invalid("El filtro de estado es inválido")

  const cuentaParam = (url.searchParams.get("cuenta") ?? "").trim()
  if (cuentaParam && !CUENTA_RE.test(cuentaParam)) return invalid("El filtro de cuenta es inválido")

  const q = (url.searchParams.get("q") ?? "").trim()
  if (q.length > INTENTOS_Q_MAX) return invalid("La búsqueda es demasiado larga")

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
    const { items, total } = await listarIntentos(guard.tenantId, {
      dias,
      proveedor,
      cuenta: cuentaParam || undefined,
      clase,
      q,
      start,
      limit,
    })
    return Response.json({ items, total }, { headers: NO_STORE })
  } catch (err) {
    // Falla ruidosa (500 + log), nunca una lista vacía que parezca "no hay intentos". Al log va sólo
    // el tenant, el nombre y el código del error: el mensaje de Postgres puede traer datos.
    const e = err as { name?: unknown; code?: unknown }
    console.error(
      `[admin/pagos-intentos] no se pudo listar tenant=${guard.tenantId} error=${String(e?.name ?? "Error")} codigo=${String(e?.code ?? "sin código")}`,
    )
    return Response.json(
      { error: "No se pudieron cargar los intentos de pago. Inténtelo nuevamente.", code: "internal" },
      { status: 500, headers: NO_STORE },
    )
  }
}
