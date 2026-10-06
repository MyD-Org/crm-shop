import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { esIdAlegra } from "@/lib/alegra";
import { listaPrivadaDelComprador } from "@/lib/lista-cuenta-repo";
import { preciosCuentaPorIds } from "@/lib/precios-privados-repo";
import { permitir } from "@/lib/rate-limit";

/** Una página del catálogo son 24; con carruseles de la home alcanza de sobra. */
const MAX_IDS = 60;
const USOS_POR_MINUTO = 120;

/** El precio es por usuario: jamás en una caché compartida ni del navegador. */
const SIN_CACHE = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SIN_CACHE });
}

/**
 * GET /api/precios-cuenta?ids=1,2,3 → `{ conLista, precios }`.
 *
 * Es el único camino por el que un precio de lista privada llega al navegador. `conLista: false` =
 * el visitante no tiene lista privada (anónimo, sin cuenta vinculada, contado, sin lista o sin
 * enlace): el navegador deja de preguntar y queda el precio público. Con lista, `precios` trae por
 * id `{ price, precioFinal? }` o `null` ("Consulte": sin precio en su lista). La lista sale
 * SIEMPRE de la sesión, nunca de la URL.
 */
export async function GET(req: Request) {
  try {
    const listaId = await listaPrivadaDelComprador();
    if (!listaId) return json({ conLista: false, precios: {} });

    const { cliente } = await identidadActual();
    if (!permitir(`precios-cuenta:${cliente?.codigocliente ?? "sin-cliente"}`, USOS_POR_MINUTO, 60_000)) {
      return json({ error: "Demasiadas consultas. Inténtelo de nuevo en un momento." }, 429);
    }

    const ids = [
      ...new Set((new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(esIdAlegra)),
    ].slice(0, MAX_IDS);

    return json({ conLista: true, precios: await preciosCuentaPorIds(listaId, ids) });
  } catch (err) {
    console.error(`[precios-cuenta] ${err instanceof Error ? err.name : "desconocido"}`);
    return json({ error: "No se pudieron obtener sus precios." }, 503);
  }
}
