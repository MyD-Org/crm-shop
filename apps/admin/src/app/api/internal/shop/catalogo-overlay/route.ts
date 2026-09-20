import { parsearParamsDelta } from "@/lib/catalogo-overlay-contrato"
import { contratoOverlayV1 } from "@/lib/catalogo-overlay-repo"
import { bearerMatches } from "@/lib/secure-compare"

// GET /api/internal/shop/catalogo-overlay?tenant=&desde=&cursor=&limit= — página del delta del
// overlay comercial. Contrato: platform/contracts/catalogo-overlay/v1 (schema-overlay.json).
//
// Incremental con cursor keyset COMPUESTO (updatedAt, alegraId): una masiva escribe centenares
// de filas con el mismo updatedAt y un cursor simple perdería filas o las repetiría para
// siempre al cortar en medio de un lote empatado. Sin borrados: despublicar viaja como
// visible:false.
//
// Auth: Bearer SHOP_CRM_SECRET (no INTERNAL_SECRET, ver la ruta de taxonomía).
// Sólo lectura, sólo el tenant del parámetro, nunca se cachea.

const NO_STORE = { "Cache-Control": "no-store" }

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.SHOP_CRM_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE })
  }

  const params = new URL(req.url).searchParams
  const tenant = params.get("tenant")?.trim()
  if (!tenant) return Response.json({ error: "missing tenant" }, { status: 400, headers: NO_STORE })

  const parsed = parsearParamsDelta(params)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers: NO_STORE })

  const payload = await contratoOverlayV1(tenant, parsed.value)
  if (!payload) return Response.json({ error: "tenant not found" }, { status: 404, headers: NO_STORE })

  return Response.json(payload, { headers: NO_STORE })
}
