import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { armarContexto } from "@/lib/etiquetas-repo"

// GET /api/admin/etiquetas/contexto — datos de la tienda para la pantalla de etiquetas:
//   { tenant:{nombre, rubro, logoPath, shopUrl|null}, sucursales:[…], marcas:[{clave,nombre}] }
// admin+ (requireAdminPlus: sin sesión → 401, operator → 404). Tenant = el del guard, siempre.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  try {
    return Response.json(await armarContexto(guard.tenantId, process.env), { headers: NO_STORE })
  } catch (e) {
    console.error("[etiquetas/contexto] error:", e)
    return Response.json(
      { error: "No se pudieron cargar los datos de la tienda. Inténtelo nuevamente." },
      { status: 500, headers: NO_STORE },
    )
  }
}
