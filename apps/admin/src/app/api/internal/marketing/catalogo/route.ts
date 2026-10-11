// src/app/api/internal/marketing/catalogo/route.ts
import { listarProductos } from "@/lib/catalogo-overlay-repo"
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"
import { urlPublicaFoto } from "@/lib/shop-media"

export const dynamic = "force-dynamic"

// Vista reducida del catálogo para planificar y renderizar: sólo lo visible y con stock.
export async function GET(req: Request) {
  const auth = autenticarInterno(req, ["planificador", "studio"])
  if (!auth.ok) return auth.response
  const q = new URL(req.url).searchParams
  const limite = Math.min(Number(q.get("limite") ?? 50) || 50, 100)
  const { items } = await listarProductos(auth.tenantId, { q: q.get("q") ?? undefined, estado: "visible", stock: "con" }, { limit: limite })
  return jsonInterno({
    items: items.map((p) => ({
      alegraId: p.alegraId,
      nombre: p.nombreEfectivo,
      sku: p.sku,
      categoria: p.categoriaNombre,
      stock: p.stock,
      precios: p.prices,
      fotos: p.fotos.map((f) => ({ key: f.key, w: f.w, url: urlPublicaFoto(f.key) })),
    })),
  })
}
