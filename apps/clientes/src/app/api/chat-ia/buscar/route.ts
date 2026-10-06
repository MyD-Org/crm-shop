import { NextResponse } from "next/server";
import { getArbolCategorias } from "@/lib/catalog";
import { chatIaHabilitado } from "@/lib/chat-ia-flag";
import { aProductoAgente, facetasDeProductos, limiteBusqueda } from "@/lib/chat-ia-productos";
import { buscarEnShop } from "@/lib/busqueda-v2/motor-servidor";
import { flagsPublicos } from "@/lib/flags-publicos";
import { usarAtributosEstructurados } from "@/lib/catalogo-atributos-uso";
import { dispCatalogo } from "@/lib/zona-servidor";
import { permitir } from "@/lib/rate-limit";

/**
 * Las llamadas llegan desde ai-api (la tool `buscar_productos`), así que casi
 * todas comparten IP: el tope es por IP pero holgado. Lo que frena el abuso de
 * un usuario del chat son sus topes diarios en ai-api, no esto.
 */
const USOS_POR_MINUTO = 300;
const LARGO_MAX_Q = 120;

const SIN_CACHE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: SIN_CACHE });
}

function ipDe(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "sin-ip";
}

/**
 * GET /api/chat-ia/buscar?q=<texto>&limit=<n>[&facetas=1]
 *
 * Búsqueda del catálogo para el agente vendedor del chat. Es LA MISMA búsqueda
 * del Shop: pasa por el motor único (`buscarEnShop`, superficie `chat`), así
 * que el agente no tiene una búsqueda propia y encuentra lo mismo que el
 * cliente en la tienda. Con el flag `busqueda-motor-unico` prendido corre la
 * cascada (código, plan, exacta y tolerante a typos con el plan); apagado, el
 * legado (exacta y tolerante). La respuesta no cambia con el flag: la etapa
 * que resolvió NO se expone (sólo el log `[busqueda] superficie=chat …`, sin
 * la consulta). Devuelve la forma compacta `ProductoAgente`.
 *
 * Pública y de solo lectura, como /api/shop/catalogo: el catálogo ya es
 * público. Precios de la lista general (no hay sesión: llama ai-api).
 *
 * Con `facetas=1` (el vendedor que filtra el catálogo, spec catálogo asistido):
 * `{ productos, facetas }`, con `facetas.categorias`, `facetas.marcas` y
 * `facetas.atributos` como `{ id, nombre }` del conjunto encontrado, con los
 * mismos ids que filtra el catálogo (`navigate_catalog` sólo puede proponer
 * ids que aparecieron acá). Sin el parámetro, el array de siempre.
 */
export async function GET(req: Request) {
  if (!(await chatIaHabilitado())) return json({ error: "No encontrado." }, 404);
  if (!permitir(`chat-ia-buscar:${ipDe(req)}`, USOS_POR_MINUTO, 60_000)) {
    return json({ error: "Demasiadas búsquedas. Reintentar en un momento." }, 429);
  }

  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim().slice(0, LARGO_MAX_Q);
  if (!q) return json({ error: "Falta el texto a buscar (q)." }, 400);
  const limit = limiteBusqueda(params.get("limit"));

  try {
    // Con el flag `disponibilidad-sucursal`, el mismo criterio que el catálogo: stock en cualquier
    // local y sin lo que ninguna sucursal ofrece (el agente no ofrece lo oculto ni stock que no hay).
    // Datos técnicos estructurados (`ProductoAgente.atributos`) si la tabla del CRM está disponible.
    const [{ soloVisibles }, disp, estructurados] = await Promise.all([
      flagsPublicos(),
      dispCatalogo(),
      // Misma regla que el catálogo y la ficha: flag `busqueda-ia` y tabla disponible.
      usarAtributosEstructurados(),
    ]);
    // Búsqueda del motor único (superficie `chat`; cascada o legado según el flag).
    // Sin filtro de stock (el agente puede mencionar lo agotado) y sin contar el total.
    const { productos } = await buscarEnShop(
      {
        consulta: q,
        filtros: estructurados ? { atributosEstructurados: true } : {},
        orden: "relevancia",
        pagina: 1,
        porPagina: limit,
      },
      { superficie: "chat", soloVisibles, disp },
    );
    if (params.get("facetas") !== "1") return json(productos.map(aProductoAgente));
    // Nombres de las categorías propias (lo que viaja en `?categoria=`). Si el
    // árbol no se puede leer, las facetas salen con la categoría de Alegra.
    const arbol = await getArbolCategorias().catch(() => []);
    const nombres = new Map(arbol.map((n) => [n.id, n.nombre]));
    return json({ productos: productos.map(aProductoAgente), facetas: facetasDeProductos(productos, nombres) });
  } catch (err) {
    console.error(`[chat-ia/buscar] ${err instanceof Error ? err.name : "desconocido"}`);
    return json({ error: "No se pudo buscar en el catálogo." }, 502);
  }
}
