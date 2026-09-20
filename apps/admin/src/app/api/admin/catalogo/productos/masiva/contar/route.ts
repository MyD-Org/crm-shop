import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE, parsearSeleccion } from "@/lib/catalogo-admin"
import { contarSeleccion } from "@/lib/catalogo-overlay-repo"

// POST /api/admin/catalogo/productos/masiva/contar — cuántos productos alcanza una selección.
//
// Existe para una sola cosa: que la confirmación de una masiva diga el número EXACTO y que ese
// número lo cuente el servidor ("Va a ocultar 5900 productos. ¿Confirma?"). Con selección por
// filtro, el cliente no tiene forma de saberlo sin traerse el catálogo entero.
//
// No escribe nada, así que no avisa al Shop.

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const seleccion = parsearSeleccion(await req.json().catch(() => null))
  if (seleccion instanceof Response) return seleccion

  const afectados = await contarSeleccion(guard.tenantId, seleccion)
  return Response.json({ afectados }, { headers: NO_STORE })
}
