import { NextResponse } from "next/server";
import { identidadActual, idPriceListCliente } from "@/lib/auth";
import { esIdAlegra } from "@/lib/alegra";
import { preciosCuentaPorIds } from "@/lib/catalog";
import { permitir } from "@/lib/rate-limit";

/** Una página del catálogo son 24; con carruseles de la home alcanza de sobra. */
const MAX_IDS = 60;
const USOS_POR_MINUTO = 120;

const SIN_CACHE = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SIN_CACHE });
}

/**
 * GET /api/precios-cuenta?ids=1,2,3 → `{ especial, precios }`.
 *
 * `especial: false` = el visitante no tiene lista propia (anónimo, sin cuenta
 * vinculada o con la general): el navegador deja de preguntar. `precios` trae
 * sólo los ids cuya lista propia es más barata que la general. La lista sale
 * SIEMPRE de la sesión, nunca de la URL.
 */
export async function GET(req: Request) {
  const { cliente } = await identidadActual();
  if (!cliente) return json({ especial: false, precios: {} });

  const idPriceList = await idPriceListCliente(cliente.codigocliente);
  if (!idPriceList) return json({ especial: false, precios: {} });

  if (!permitir(`precios-cuenta:${cliente.codigocliente}`, USOS_POR_MINUTO, 60_000)) {
    return json({ error: "Demasiadas consultas. Inténtelo de nuevo en un momento." }, 429);
  }

  const ids = [
    ...new Set((new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(esIdAlegra)),
  ].slice(0, MAX_IDS);

  try {
    return json({ especial: true, precios: await preciosCuentaPorIds(ids, idPriceList) });
  } catch (err) {
    console.error(`[precios-cuenta] ${err instanceof Error ? err.name : "desconocido"}`);
    return json({ error: "No se pudieron obtener sus precios." }, 503);
  }
}
