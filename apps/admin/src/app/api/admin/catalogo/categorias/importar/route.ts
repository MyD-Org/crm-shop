import { requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, NO_STORE } from "@/lib/catalogo-admin"
import { importarCategoriasDeAlegra } from "@/lib/catalogo-overlay-repo"

// POST /api/admin/catalogo/categorias/importar — crea una categoría propia por cada categoría de
// Alegra y clasifica con ella a los productos que la tengan.
//
// Es un atajo para no arrancar de cero: la taxonomía propia nace vacía y clasificar miles de
// productos a mano es el verdadero costo del cambio. Se puede correr más de una vez sin duplicar
// nada, y NUNCA pisa una clasificación hecha a mano.
//
// admin+ (operator → 404). Tenant = el del guard, siempre.

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const resultado = await importarCategoriasDeAlegra(guard.tenantId, guard.user.id)
  if (resultado.creadas > 0 || resultado.clasificados > 0) await avisarShop(guard.tenantId)

  return Response.json(resultado, { headers: NO_STORE })
}
