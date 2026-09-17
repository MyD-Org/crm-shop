import { NextResponse } from "next/server";
import { syncCatalog } from "@/lib/catalog-sync";
import { bearerMatches } from "@/lib/secure-compare";

// Se pide el máximo del plan Hobby igual, aunque hoy no alcance para el catálogo
// entero: sirve para el uso que le queda a esta ruta (ver abajo).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Refresca el espejo local del catálogo desde Alegra.
 *
 * YA NO LO LLAMA NINGÚN CRON. La corrida diaria se mudó a GitHub Actions
 * (.github/workflows/catalogo-sync.yml), que ejecuta la sync dentro del runner:
 * el catálogo creció a ~5959 ítems y, con la paginación de a 30 de Alegra más
 * los 429, la corrida pasó los 300 s que topea una función en el plan Hobby.
 *
 * La ruta se mantiene porque sigue siendo el disparo más cómodo a mano —en dev,
 * o contra producción si hay que refrescar fuera de horario— pero contra un
 * catálogo grande se va a comer el timeout. Para una corrida confiable:
 * `npm run sync:catalogo`, o "Run workflow" en Actions.
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
