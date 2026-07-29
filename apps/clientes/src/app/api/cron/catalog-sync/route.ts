import { NextResponse } from "next/server";
import { syncCatalog } from "@/lib/catalog-sync";
import { bearerMatches } from "@/lib/secure-compare";

// Recorrer ~2800 items paginando de a 30 no entra en el default: se pide el máximo.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Refresca el espejo local del catálogo desde Alegra.
 * Lo invoca Vercel Cron una vez por día (ver vercel.json), autenticado con
 * CRON_SECRET. En dev se dispara a mano:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/catalog-sync
 */
export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await syncCatalog("cron");
  if (!result.ok) {
    console.error("[cron/catalog-sync] falló:", result.error);
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
