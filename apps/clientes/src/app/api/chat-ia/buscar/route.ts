import { NextResponse } from "next/server";
import { getCatalogo } from "@/lib/catalog";
import { chatIaHabilitado } from "@/lib/chat-ia-flag";
import { aProductoAgente, limiteBusqueda } from "@/lib/chat-ia-productos";
import { diagnosticoAiApi } from "@/lib/ai-api-config";
import { flagsPublicos } from "@/lib/flags-publicos";
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
 * GET /api/chat-ia/buscar?q=<texto>&limit=<n>
 *
 * Búsqueda del catálogo para el agente vendedor del chat. Es LA MISMA búsqueda
 * del Shop (términos, plurales, relevancia y el segundo intento tolerante a
 * typos): el agente no tiene una búsqueda propia, así que encuentra lo mismo
 * que el cliente en la tienda. Devuelve la forma compacta `ProductoAgente`.
 *
 * Pública y de solo lectura, como /api/shop/catalogo: el catálogo ya es
 * público. Precios de la lista general (no hay sesión: llama ai-api).
 */
export async function GET(req: Request) {
  // TEMPORAL (diagnóstico, revertir): el 404 dice qué variable de ai-api falta, sin valores.
  if (!(await chatIaHabilitado())) return json({ error: "No encontrado.", diagnostico: diagnosticoAiApi() }, 404);
  if (!permitir(`chat-ia-buscar:${ipDe(req)}`, USOS_POR_MINUTO, 60_000)) {
    return json({ error: "Demasiadas búsquedas. Reintentar en un momento." }, 429);
  }

  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim().slice(0, LARGO_MAX_Q);
  if (!q) return json({ error: "Falta el texto a buscar (q)." }, 400);
  const limit = limiteBusqueda(params.get("limit"));

  try {
    const { soloVisibles } = await flagsPublicos();
    let productos = await getCatalogo({ busqueda: q, limit, soloVisibles });
    // Mismo criterio que el buscador del Shop: si lo exacto no trae nada, se
    // reintenta tolerando typos. Si ese intento falla, queda lo exacto (vacío).
    if (productos.length === 0) {
      productos = await getCatalogo({ busqueda: q, limit, soloVisibles, tolerante: true }).catch((err: unknown) => {
        console.error(`[chat-ia/buscar] falló la búsqueda tolerante: ${err instanceof Error ? err.name : "desconocido"}`);
        return productos;
      });
    }
    return json(productos.map(aProductoAgente));
  } catch (err) {
    console.error(`[chat-ia/buscar] ${err instanceof Error ? err.name : "desconocido"}`);
    return json({ error: "No se pudo buscar en el catálogo." }, 502);
  }
}
