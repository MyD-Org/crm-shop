import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { campaniasVigentes } from "@/lib/campanias/vigentes";
import { paginaOfertasPublica } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import { listaPrivadaDelComprador } from "@/lib/lista-cuenta-repo";
import { ofertasQueAplican } from "@/lib/ofertas-cuenta";
import { preciosCuentaPorIds } from "@/lib/precios-privados-repo";
import { permitirAsync } from "@/lib/rate-limit";

const USOS_POR_MINUTO = 60;

/** Depende de la lista de la cuenta: jamás en una caché compartida ni del navegador. */
const SIN_CACHE = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SIN_CACHE });
}

/**
 * GET /api/ofertas-cuenta → `{ conLista: false }` o `{ conLista: true, ids }`: las ofertas vigentes
 * (las de «Solo ofertas», misma caché del catálogo) cuyo precio de campaña es menor que el de la
 * lista privada de la cuenta. Con eso la barra, el menú, el bloque de la home y la página de ofertas
 * le muestran a una cuenta con lista propia sólo lo que le sirve. La lista sale SIEMPRE de la sesión.
 */
export async function GET() {
  try {
    const listaId = await listaPrivadaDelComprador();
    if (!listaId) return json({ conLista: false });

    const { cliente } = await identidadActual();
    if (!await permitirAsync(`ofertas-cuenta:${cliente?.codigocliente ?? "sin-cliente"}`, USOS_POR_MINUTO, 60_000)) {
      return json({ error: "Demasiadas consultas. Inténtelo de nuevo en un momento." }, 429);
    }

    const campanias = await campaniasVigentes();
    if (campanias.length === 0) return json({ conLista: true, ids: [] });

    const { soloVisibles, variantes } = await flagsPublicos();
    const { productos } = await paginaOfertasPublica({
      soloVisibles,
      ...(variantes ? { agrupar: true } : {}),
      campanias,
    });
    if (productos.length === 0) return json({ conLista: true, ids: [] });

    const privados = await preciosCuentaPorIds(listaId, productos.map((p) => p.id));
    return json({ conLista: true, ids: ofertasQueAplican(productos, privados) });
  } catch (err) {
    console.error(`[ofertas-cuenta] ${err instanceof Error ? err.name : "desconocido"}`);
    return json({ error: "No se pudieron obtener sus ofertas." }, 503);
  }
}
