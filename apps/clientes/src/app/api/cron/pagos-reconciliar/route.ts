import { NextResponse } from "next/server";
import { reconciliarPagosPendientes } from "@/lib/pagos/reconciliar";
import { avisarPedidoSiFalta, pedidosConAvisosPendientes } from "@/lib/pedido-avisos";
import { bearerMatches } from "@/lib/secure-compare";

// Cada consulta a MP es un round-trip HTTP; el default puede quedar corto si
// hay una decena de pendientes atrasados.
export const maxDuration = 120;

/**
 * Barre pedidos con pago pendiente para el caso en que el webhook nunca haya
 * llegado. Y, como respaldo, manda los avisos de los pedidos por transferencia que siguen sin avisar
 * a los 15 minutos (el navegador no llegó a avisar al irse de la pantalla: ver
 * `/api/pedidos/:id/avisos`). Lo dispara Vercel Cron (ver vercel.json), autenticado con
 * CRON_SECRET. Para probar a mano:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/pagos-reconciliar
 */
export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const resultado = await reconciliarPagosPendientes();
    console.log(
      `[cron/pagos-reconciliar] revisados=${resultado.revisados} actualizados=${resultado.actualizados} errores=${resultado.errores}`,
    );
    // Un error acá no tapa la reconciliación de arriba: cada aviso nunca lanza.
    let avisados = 0;
    try {
      for (const id of await pedidosConAvisosPendientes()) if (await avisarPedidoSiFalta(id)) avisados++;
    } catch (err) {
      console.error("[cron/pagos-reconciliar] no se pudieron buscar los avisos pendientes:", err);
    }
    if (avisados > 0) console.log(`[cron/pagos-reconciliar] avisos de pedidos enviados=${avisados}`);
    return NextResponse.json({ ok: true, ...resultado, avisados });
  } catch (err) {
    console.error("[cron/pagos-reconciliar] error inesperado:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
