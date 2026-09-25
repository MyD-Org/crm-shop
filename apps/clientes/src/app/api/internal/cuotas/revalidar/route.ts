import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { TAG_CUOTAS } from "@/lib/cache-tags";
import { syncConfigCRM } from "@/lib/cuotas-sync";
import { bearerMatches } from "@/lib/secure-compare";

export const maxDuration = 30;

/**
 * Ping del CRM tras guardar proveedores o escalones de cuotas (contrato v2).
 *
 * El body se IGNORA siempre (ni se lee): el ping sólo dispara el re-pull del
 * GET interno del CRM, único camino de ingestión validado. Así un ping no
 * puede inyectar configuración.
 *
 * 401 secreto inválido · 200 { ok, fetchedAt } · 502 CRM caído o payload
 * inválido (la caché anterior queda intacta).
 *
 * Con la config nueva guardada, vence la oferta cacheada (tag `cuotas`, ver
 * src/lib/cuotas-datos.ts): la próxima vista ya muestra los escalones nuevos.
 */
export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.SHOP_CRM_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const r = await syncConfigCRM("ping");
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  }
  revalidateTag(TAG_CUOTAS, { expire: 0 });
  return NextResponse.json({ ok: true, fetchedAt: r.fetchedAt });
}
