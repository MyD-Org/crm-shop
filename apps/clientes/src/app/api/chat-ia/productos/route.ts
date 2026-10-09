import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { esIdAlegra } from "@/lib/alegra";
import { getProductosPorIds } from "@/lib/catalog";
import { chatIaHabilitado } from "@/lib/chat-ia-flag";
import { aProductoResuelto, MAX_IDS_RESOLVER } from "@/lib/chat-ia-productos";
import { flagsPublicos } from "@/lib/flags-publicos";
import { listaPrivadaDelComprador } from "@/lib/lista-cuenta-repo";
import { precioPrivado } from "@/lib/precio-cuenta";
import { preciosPrivados } from "@/lib/precios-privados-repo";
import { usarAtributosEstructurados } from "@/lib/catalogo-atributos-uso";
import { dispCatalogo } from "@/lib/zona-servidor";
import { permitirAsync } from "@/lib/rate-limit";

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
 * y el precio sale de acá, con la lista privada de quien mira (si la tiene) — la misma que
 * después aplica el carrito. La lista sale SIEMPRE de la sesión, nunca de la URL.
 * Sólo productos activos y publicados, en el orden pedido; un id que la tienda
 * no tiene no aparece (el widget muestra el texto de respaldo de la card).
 */
export async function GET(req: Request) {
  if (!(await chatIaHabilitado())) return json({ error: "No encontrado." }, 404);

  const identidad = await identidadActual();
  const quien = identidad.cliente?.codigocliente ?? identidad.clerkUserId ?? ipDe(req);
  if (!await permitirAsync(`chat-ia-productos:${quien}`, USOS_POR_MINUTO, 60_000)) {
    return json({ error: "Demasiadas consultas. Reintentar en un momento." }, 429);
  }

  const ids = [
    ...new Set((new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(esIdAlegra)),
  ].slice(0, MAX_IDS_RESOLVER);
  if (ids.length === 0) return json([]);

  try {
    const [{ soloVisibles }, disp, idListaPrivada, estructurados] = await Promise.all([
      flagsPublicos(),
      dispCatalogo(),
      identidad.cliente ? listaPrivadaDelComprador() : Promise.resolve(null),
      // Misma regla que el catálogo y la ficha: flag `busqueda-ia` y tabla disponible.
      usarAtributosEstructurados(),
    ]);
    const productos = await getProductosPorIds(ids, {
      soloActivos: true,
      soloVisibles,
      disp,
      // Card `spec`: valores técnicos estructurados si la tabla del CRM está disponible.
      ...(estructurados ? { atributosEstructurados: true } : {}),
    });
    // Con lista privada: su precio (sin "con medio" ni cuotas). Sin precio en su lista, la card no
    // se resuelve y el widget muestra su texto de respaldo ("Consulte"), nunca el precio público.
    const privados = idListaPrivada ? await preciosPrivados(idListaPrivada, ids) : null;
    return json(ids.flatMap((id) => {
      const p = productos.get(id);
      if (!p) return [];
      if (!privados) return [aProductoResuelto(p)];
      const propio = precioPrivado(privados.get(id) ?? null, p.ivaPorcentaje ?? null);
      if (!propio) return [];
      return [
        aProductoResuelto({
          ...p,
          price: propio.price,
          precioFinal: propio.precioFinal,
          precioMedio: undefined,
          preciosMedios: undefined,
          preciosFormaModal: undefined,
          preciosOfflineModal: undefined,
          cuotasSinInteres: undefined,
        }),
      ];
    }));
  } catch (err) {
    console.error(`[chat-ia/productos] ${err instanceof Error ? err.name : "desconocido"}`);
    return json({ error: "No se pudieron obtener los productos." }, 502);
  }
}
