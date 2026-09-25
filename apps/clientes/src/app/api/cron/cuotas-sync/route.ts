import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { TAG_CUOTAS } from "@/lib/cache-tags";
import { syncCuotas } from "@/lib/cuotas-sync";
import { bearerMatches } from "@/lib/secure-compare";

// Dos fuentes chicas (CRM + /installments por marca): alcanza con 60 s.
export const maxDuration = 60;

/**
 * Sincroniza planes de cuotas del proveedor y config del CRM (contrato v2).
 * Lo invoca Vercel Cron (ver vercel.json), autenticado con CRON_SECRET.
 * Cada fuente conserva su última copia buena si falla. Después de correr (aun
 * con una fuente caída: la otra pudo traer datos nuevos, y la que falló
 * conserva su copia) vence la oferta cacheada (tag `cuotas`). En dev:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/cuotas-sync
 */
export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await syncCuotas("cron");
  revalidateTag(TAG_CUOTAS, { expire: 0 });
  if (!result.ok) {
    console.error("[cron/cuotas-sync] corrida con fallos:", JSON.stringify(result));
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
