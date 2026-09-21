import { contratoTaxonomiaV1 } from "@/lib/catalogo-overlay-repo"
import { bearerMatches } from "@/lib/secure-compare"

// GET /api/internal/shop/taxonomia?tenant={tenants.id} — el Shop lee la taxonomía propia de la
// tienda ENTERA (categorías, incluidas las inactivas) más el diccionario COMPLETO de tags.
// Contrato: platform/contracts/catalogo-overlay/v1 (schema-taxonomia.json).
//
// Va entero y no por delta porque son decenas de filas y el Shop lo aplica como reemplazo
// atómico: un delta acá obligaría a modelar tombstones para ganar unos pocos KB. Y el
// diccionario de tags viaja con la taxonomía —y no dentro del overlay— para que renombrar un
// tag usado por 800 productos no empuje ni una fila al delta.
//
// Auth: Bearer SHOP_CRM_SECRET, la llave propia del Shop. NO INTERNAL_SECRET: esa es la de
// ai-api y además abre /api/agent/* (facturas, saldos, contactos).
// Sólo lectura, sólo el tenant del parámetro, nunca se cachea.

const NO_STORE = { "Cache-Control": "no-store" }

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.SHOP_CRM_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE })
  }

  const tenant = new URL(req.url).searchParams.get("tenant")?.trim()
  if (!tenant) return Response.json({ error: "missing tenant" }, { status: 400, headers: NO_STORE })

  const payload = await contratoTaxonomiaV1(tenant)
  if (!payload) return Response.json({ error: "tenant not found" }, { status: 404, headers: NO_STORE })

  return Response.json(payload, { headers: NO_STORE })
}
