import { NextResponse } from "next/server";
import { procesarAvisos } from "@/lib/aviso-reingreso-cron";
import { bearerMatches } from "@/lib/secure-compare";

// Un mail por aviso (hasta 200 por corrida): cada envío es un round-trip a Resend.
export const maxDuration = 120;

/**
 * Avisa a quienes pidieron «Avisarme cuando ingrese» que el producto volvió a estar disponible. Lo
 * normal es que el barrido corra solo, con el aviso del CRM de que cambió el catálogo
 * (`api/internal/catalogo/revalidar`). Esta ruta queda para dispararlo a mano, autenticada con
 * CRON_SECRET. Con el flag `aviso-reingreso` apagado no envía nada. Para probar a mano:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/aviso-reingreso
 */
export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const r = await procesarAvisos();
    console.log(
      `[cron/aviso-reingreso] omitido=${r.omitido} revisados=${r.revisados} enviados=${r.enviados} errores=${r.errores} purgados=${r.purgados}`,
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("[cron/aviso-reingreso] error inesperado:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Error inesperado" }, { status: 500 });
  }
}
