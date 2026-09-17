import { NextResponse } from "next/server";
import { syncConfigCRM } from "@/lib/cuotas-sync";
import { bearerMatches } from "@/lib/secure-compare";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Ping del CRM tras guardar medios u opciones de cuotas (contrato v1, punto 2).
 *
 * El body se IGNORA siempre (ni se lee): el ping sólo dispara el re-pull del
 * GET interno del CRM, único camino de ingestión validado. Así un ping no
 * puede inyectar configuración.
 *
 * 401 secreto inválido · 200 { ok, fetchedAt } · 502 CRM caído o payload
 * inválido (la caché anterior queda intacta).
 */
export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.INTERNAL_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const r = await syncConfigCRM("ping");
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, fetchedAt: r.fetchedAt });
}
