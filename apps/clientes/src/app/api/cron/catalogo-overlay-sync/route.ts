import { NextResponse } from "next/server";
import { fetchersCRM, repoCatalogoDrizzle } from "@/lib/catalogo-repo";
import { sincronizarCatalogo } from "@/lib/catalogo-sync-overlay";
import { bearerMatches } from "@/lib/secure-compare";

// El delta viene paginado, así que una corrida son varias vueltas contra el CRM.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Copia el catálogo comercial del CRM (contrato catalogo-overlay/v1).
 *
 * Lo invoca el cron, autenticado con CRON_SECRET. Si el CRM falla, la copia anterior queda
 * intacta: la tienda sigue sirviendo los datos de la última corrida buena. En dev:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/catalogo-overlay-sync
 */
export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const resultado = await sincronizarCatalogo(
    { repo: repoCatalogoDrizzle(), ...fetchersCRM(), ahora: () => new Date() },
    "cron",
  );

  return NextResponse.json(resultado, { status: resultado.ok ? 200 : 502 });
}
