import { NextResponse } from "next/server";
import { identidadActual, idPriceListCliente } from "@/lib/auth";
import { esIdAlegra } from "@/lib/alegra";
import { getProductosPorIds } from "@/lib/catalog";
import { chatIaHabilitado } from "@/lib/chat-ia-flag";
import { aProductoResuelto, MAX_IDS_RESOLVER } from "@/lib/chat-ia-productos";
import { flagsPublicos } from "@/lib/flags-publicos";
import { dispCatalogo } from "@/lib/zona-servidor";
import { permitir } from "@/lib/rate-limit";

/** Una por card del chat; el widget pide una vez por card. */
const USOS_POR_MINUTO = 60;

const SIN_CACHE = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SIN_CACHE });
}

function ipDe(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "sin-ip";
}

/**
 * GET /api/chat-ia/productos?ids=1,2,3 → `ProductoResuelto[]`
 *
 * Completa las cards del chat (`resolveProducts` del widget): la card trae ids
 * y el precio sale de acá, con la lista de precios de quien mira — la misma que
 * después aplica el carrito. La lista sale SIEMPRE de la sesión, nunca de la URL.
 * Sólo productos activos y publicados, en el orden pedido; un id que la tienda
 * no tiene no aparece (el widget muestra el texto de respaldo de la card).
 */
export async function GET(req: Request) {
  if (!(await chatIaHabilitado())) return json({ error: "No encontrado." }, 404);

  const identidad = await identidadActual();
  const quien = identidad.cliente?.codigocliente ?? identidad.clerkUserId ?? ipDe(req);
  if (!permitir(`chat-ia-productos:${quien}`, USOS_POR_MINUTO, 60_000)) {
    return json({ error: "Demasiadas consultas. Reintentar en un momento." }, 429);
  }

  const ids = [
    ...new Set((new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(esIdAlegra)),
  ].slice(0, MAX_IDS_RESOLVER);
  if (ids.length === 0) return json([]);

  try {
    const [{ soloVisibles }, disp, idPriceList] = await Promise.all([
      flagsPublicos(),
      dispCatalogo(),
      identidad.cliente ? idPriceListCliente(identidad.cliente.codigocliente) : Promise.resolve(undefined),
    ]);
    const productos = await getProductosPorIds(ids, {
      idPriceList: idPriceList ?? undefined,
      soloActivos: true,
      soloVisibles,
      disp,
    });
    return json(ids.flatMap((id) => {
      const p = productos.get(id);
      return p ? [aProductoResuelto(p)] : [];
    }));
  } catch (err) {
    console.error(`[chat-ia/productos] ${err instanceof Error ? err.name : "desconocido"}`);
    return json({ error: "No se pudieron obtener los productos." }, 502);
  }
}
