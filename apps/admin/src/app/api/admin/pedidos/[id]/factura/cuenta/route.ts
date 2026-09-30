import { adminNotFoundResponse, requireOperatorPlus } from "@/lib/admin-route-guard"
import { armarCuentaFacturaDto, cargarContextoCuentaFactura } from "@/lib/pedido-factura-cuenta-repo"
import { getPedido } from "@/lib/pedidos-repo"

// GET /api/admin/pedidos/[id]/factura/cuenta → qué cuenta de Alegra factura el pedido (calculada o
// elegida), por qué, si la venta es entre empresas ("factura cruzada") y la auditoría de la
// elección. Solo lectura; la elección se guarda al emitir la factura (`factura/emitir`, admin+).
// Sin credenciales ni tokens: solo slug y nombre de cada cuenta.

const NO_STORE = { "Cache-Control": "private, no-store" }

type IdParams = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: IdParams) {
  const guard = await requireOperatorPlus(req)
  if (!guard.ok) return guard.response

  const { id } = await params
  try {
    const found = await getPedido(guard.tenantId, id)
    if (!found) return adminNotFoundResponse()
    const ctx = await cargarContextoCuentaFactura(guard.tenantId, id)
    const facturado = !!found.pedido.facturaAlegraId
    return Response.json(armarCuentaFacturaDto(found.pedido, ctx, facturado), { headers: NO_STORE })
  } catch (err) {
    console.error("[admin/pedidos/factura/cuenta] no se pudo leer", { tenant: guard.tenantId, orderId: id, err })
    return Response.json(
      { error: "No se pudo consultar la cuenta que factura. Inténtelo nuevamente.", code: "internal" },
      { status: 500, headers: NO_STORE },
    )
  }
}
