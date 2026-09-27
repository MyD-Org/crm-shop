import { requireAdminPlus, adminNotFoundResponse } from "@/lib/admin-route-guard"
import { getDocumentPdf } from "@/lib/alegra"
import { getPedido } from "@/lib/pedidos-repo"
import { getTenantByIdFromDb } from "@/lib/tenants"

// PDF del remito vinculado al pedido, para el visor (`DocumentViewer` del DS) del detalle de
// pedido. Mismo criterio que el proxy del portal (`app/api/portal/documentos/[kind]/[id]`): el
// PDF se PROXEA, nunca se redirige a la URL firmada de Alegra (que autentica por posesión).
//
// `?download=1` lo baja como archivo; sin eso se sirve inline para el visor.

export const dynamic = "force-dynamic"

type IdParams = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: IdParams) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found || !found.remito) return adminNotFoundResponse()

    const config = await getTenantByIdFromDb(guard.tenantId)
    if (!config) return Response.json({ error: "No se pudo consultar Alegra para esta empresa." }, { status: 500 })
    if (config.alegraMock) return Response.json({ error: "No disponible en modo mock" }, { status: 501 })

    const doc = await getDocumentPdf(config, "remision", found.remito.remitoAlegraId)
    if (!doc?.pdfUrl) {
      return Response.json({ error: "El remito todavía no tiene PDF disponible en Alegra." }, { status: 409 })
    }

    const pdf = await fetch(doc.pdfUrl, { cache: "no-store" })
    if (!pdf.ok || !pdf.body) {
      console.error(`[admin/pedidos/remito/pdf] el CDN de Alegra devolvió ${pdf.status}`, { tenant: guard.tenantId, orderId: id })
      return Response.json({ error: "No pudimos obtener el remito." }, { status: 502 })
    }

    const download = new URL(req.url).searchParams.get("download") === "1"
    const safeNumber = (found.remito.remitoNumero ?? found.remito.remitoAlegraId).replace(/[^\w.-]+/g, "-")

    return new Response(pdf.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="remito-${safeNumber}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (err) {
    console.error("[admin/pedidos/remito/pdf] error", { tenant: guard.tenantId, orderId: id, err })
    return Response.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
