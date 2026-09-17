import { NextResponse } from "next/server";
import { syncCuotas } from "@/lib/cuotas-sync";
import { bearerMatches } from "@/lib/secure-compare";

// Dos fuentes chicas (CRM + /installments por medio): alcanza con 60 s.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Sincroniza planes de cuotas del proveedor y config del CRM (contrato v1).
 * Lo invoca Vercel Cron (ver vercel.json), autenticado con CRON_SECRET.
 * Cada fuente conserva su última copia buena si falla. En dev:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/cuotas-sync
 */
export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await syncCuotas("cron");
  if (!result.ok) {
    console.error("[cron/cuotas-sync] corrida con fallos:", JSON.stringify(result));
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
