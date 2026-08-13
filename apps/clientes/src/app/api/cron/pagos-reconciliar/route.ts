import { NextResponse } from "next/server";
import { reconciliarPagosPendientes } from "@/lib/pagos/reconciliar";
import { bearerMatches } from "@/lib/secure-compare";

// Cada consulta a MP es un round-trip HTTP; el default puede quedar corto si
// hay una decena de pendientes atrasados.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Barre pedidos con pago pendiente para el caso en que el webhook nunca haya
 * llegado. Lo dispara Vercel Cron (ver vercel.json), autenticado con
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
    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    console.error("[cron/pagos-reconciliar] error inesperado:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
