import { authAgentTenantRequest } from "@/lib/agent-auth"
import { getTenantConfig } from "@/lib/tenant-context"
import { getItemsLiveDelCatalogo } from "@/lib/alegra-live-catalogo"

// GET /api/agent/prices?ids=it-1,it-2
// Devuelve precio/stock EN VIVO de Alegra para los productos indicados (por alegraId). Lo usa la
// tool get_live_prices del agente para confirmar precios exactos antes de armar el presupuesto.
// Ver ADR catálogo Alegra (cache para buscar, live para el número que se compromete).
export async function GET(req: Request) {
  try {
    const tenant = await getTenantConfig()
    const auth = authAgentTenantRequest(req, tenant.id)
    if (!auth) return Response.json({ error: "unauthorized" }, { status: 401 })

    const url = new URL(req.url)
    const ids = (url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    if (!ids.length) return Response.json({ error: "ids es requerido" }, { status: 400 })

    // Resuelve el id real y las credenciales de la cuenta de origen (ids sintéticos de filas solo-secundaria).
    const items = await getItemsLiveDelCatalogo(tenant, ids)

    return Response.json({
      products: items.map((it) => ({
        id: it.alegraId,
        code: it.code,
        name: it.name,
        stock: it.stock,
        prices: Object.fromEntries(it.prices.map((p) => [p.idPriceList, String(p.price)])),
      })),
    })
  } catch (err) {
    console.error("agent/prices error:", err)
    return Response.json({ error: "internal_error" }, { status: 500 })
  }
}
