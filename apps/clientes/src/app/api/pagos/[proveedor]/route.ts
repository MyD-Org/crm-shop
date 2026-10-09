import { NextResponse } from "next/server";
import { cobrarPedido } from "@/lib/pagos/cobrar";
import { rasgosProcesador } from "@/lib/pagos";

/**
 * Tiempo máximo de la función. Peor caso de Payway: POST con hasta 30 s de espera + 3 consultas de
 * hasta 15 s con pausas de 3 s (~81 s). 120 s alcanza, igual que el cron de conciliación.
 */
export const maxDuration = 120;

/**
 * POST /api/pagos/[proveedor] — cobra un pedido ya creado con el procesador de la URL.
 *
 * Es la ruta genérica: `/api/pagos/mercadopago` sigue siendo su propio archivo (URL histórica del
 * Brick) y tiene prioridad sobre ésta. Un procesador que no existe en el registro responde 404; uno
 * que existe pero no coincide con el medio del pedido responde igual que un pedido ajeno (404), y
 * uno sin credenciales, 409 (ver `cobrarPedido`). La cuenta (sucursal) la decide `cobrarPedido` con el
 * pedido, nunca la URL.
 */
export async function POST(req: Request, ctx: { params: Promise<{ proveedor: string }> }) {
  const { proveedor: id } = await ctx.params;
  if (!rasgosProcesador(id)) {
    return NextResponse.json({ error: "Ese medio de pago no está disponible." }, { status: 404 });
  }
  return cobrarPedido(id, req);
}
