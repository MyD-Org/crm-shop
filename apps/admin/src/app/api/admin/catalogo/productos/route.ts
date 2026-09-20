import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE, parsearQueryListado, conUrlDeFotos } from "@/lib/catalogo-admin"
import { leerAvisoShop, listarProductos, ultimaSyncAlegra } from "@/lib/catalogo-overlay-repo"

// GET /api/admin/catalogo/productos — listado del panel de catálogo.
//   ?q= &categoria=(uuid|sin) &estado=(visible|oculto) &foto=(con|sin) &nombre=sin
//   &alegra=(active|inactive) &tag=uuid &start= &limit= &orden=(nombre|nombre-desc|actualizado)
//
// Filtrado, conteo, orden y paginado se resuelven en Postgres: el navegador recibe una página,
// no el catálogo (REQ-ADM-01). Los filtros se combinan y el total es el de la intersección.
//
// admin+ (requireAdminPlus: operator → 404). Tenant = el del guard, siempre.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const parsed = parsearQueryListado(new URL(req.url))
  if (parsed instanceof Response) return parsed

  const { filtros, start, limit, orden } = parsed
  const [{ items, total }, avisoShop, alegra] = await Promise.all([
    listarProductos(guard.tenantId, filtros, { start, limit, orden }),
    leerAvisoShop(guard.tenantId),
    ultimaSyncAlegra(guard.tenantId),
  ])

  return Response.json(
    {
      items: items.map((i) => conUrlDeFotos(i)),
      total,
      start,
      limit,
      // Frescura que el panel rotula: la sync de Alegra es un hecho del CRM; lo de la tienda es
      // el último AVISO entregado, no su sincronización (decisión D1). Cuando no hay ninguno, la
      // UI dice "Desconocida" — nunca una fecha inventada.
      sincronizacion: { alegra, avisoShop },
    },
    { headers: NO_STORE },
  )
}
