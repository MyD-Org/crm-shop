import { connection, NextResponse } from "next/server";
import { mercadoPago } from "@/lib/pagos/mercadopago";
import { procesarWebhook } from "@/lib/pagos/webhook";

/**
 * POST /api/pagos/mercadopago/webhook — confirmación de cobro de Mercado Pago.
 *
 * URL registrada en el panel de MP: no cambia. La lógica (firma, consulta al proveedor, registrarCobro)
 * está en `procesarWebhook`, común con `POST /api/pagos/[proveedor]/webhook`. Ver ahí por qué esta
 * ruta es la fuente de verdad del estado y por qué casi todo devuelve 200.
 *
 * Corre SIN sesión de Clerk y SIN el gate del sitio (ver la excepción en `src/proxy.ts`).
 */
export function POST(req: Request) {
  return procesarWebhook(mercadoPago, req);
}

/**
 * Mercado Pago hace un GET a la URL al configurarla, para comprobar que
 * responde. Sin esto, el panel marca la notificación como fallida.
 */
export async function GET() {
  // Por request: sin esto el build podría prerenderizar la respuesta.
  await connection();
  return NextResponse.json({ ok: true });
}
