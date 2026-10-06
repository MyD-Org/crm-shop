import { NextResponse } from "next/server";
import { cobrarPedido } from "@/lib/pagos/cobrar";
import { proveedorPago } from "@/lib/pagos";

/**
 * POST /api/pagos/[proveedor] — cobra un pedido ya creado con el procesador de la URL.
 *
 * Es la ruta genérica: `/api/pagos/mercadopago` sigue siendo su propio archivo (URL histórica del
 * Brick) y tiene prioridad sobre ésta. Un procesador que no existe en el registro responde 404; uno
 * que existe pero no coincide con el medio del pedido responde igual que un pedido ajeno (404), y
 * uno sin credenciales, 409 (ver `cobrarPedido`).
 */
export async function POST(req: Request, ctx: { params: Promise<{ proveedor: string }> }) {
  const { proveedor: id } = await ctx.params;
  const proveedor = proveedorPago(id);
  if (!proveedor) {
    return NextResponse.json({ error: "Ese medio de pago no está disponible." }, { status: 404 });
  }
  return cobrarPedido(proveedor, req);
}
