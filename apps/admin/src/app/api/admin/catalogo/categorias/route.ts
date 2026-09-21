import { requireAdminPlus } from "@/lib/admin-route-guard"
import { avisarShop, duplicadoResponse, NO_STORE, validacionResponse } from "@/lib/catalogo-admin"
import { crearCategoria, listarCategoriasConUso } from "@/lib/catalogo-overlay-repo"

// GET  /api/admin/catalogo/categorias — el árbol entero del tenant (incluidas las inactivas y
//      las vacías) con el conteo de productos de cada rama. "Sin clasificar" NO sale de acá: es
//      un cajón del listado, no una fila de la taxonomía (REQ-TAX-05).
// POST /api/admin/catalogo/categorias — alta { nombre, parentId?, orden?, activa? }.
//      Rechaza el cuarto nivel y los ciclos ANTES de escribir nada, y el slug repetido entre
//      hermanas. El mismo nombre bajo padres distintos sí se puede.

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const categorias = await listarCategoriasConUso(guard.tenantId)
  return Response.json({ categorias }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const r = await crearCategoria(guard.tenantId, await req.json().catch(() => null))
  if (r.kind === "invalid") return validacionResponse(r.error, r.campo)
  if (r.kind === "duplicado") return duplicadoResponse("Ya existe una categoría con ese nombre en ese nivel", "nombre")
  if (r.kind !== "ok") return validacionResponse("No se pudo crear la categoría", "nombre")

  const { propagado } = await avisarShop(guard.tenantId)
  return Response.json({ ok: true, propagado, categoria: r.row }, { status: 201, headers: NO_STORE })
}
