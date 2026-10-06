import { NextResponse } from "next/server";
import { proveedorPago } from "@/lib/pagos";
import { procesarWebhook } from "@/lib/pagos/webhook";

/**
 * POST /api/pagos/[proveedor]/webhook — notificación de cobro de un procesador.
 *
 * `/api/pagos/mercadopago/webhook` sigue siendo su propio archivo (URL registrada en MP). Un
 * procesador desconocido, o que no avisa por webhook (no implementa `verificarWebhook`; se concilia
 * por cron), responde 404. Corre SIN sesión y SIN el gate: ver `esWebhookDePago` en `src/proxy.ts`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ proveedor: string }> }) {
  const { proveedor: id } = await ctx.params;
  const proveedor = proveedorPago(id);
  if (!proveedor?.verificarWebhook) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  return procesarWebhook(proveedor, req);
}
