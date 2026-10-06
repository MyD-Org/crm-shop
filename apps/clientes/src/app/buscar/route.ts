import { after, connection, NextResponse, type NextRequest } from "next/server";
import { busquedaIaHabilitada } from "@/lib/busqueda-ia-flag";
import { filtrosDeEstado } from "@/lib/catalogo-url";
import { flagsPublicos } from "@/lib/flags-publicos";
import { dispCatalogo } from "@/lib/zona-servidor";
import { destinoDeBusqueda } from "@/lib/busqueda-v2/buscar";
import { sinTexto } from "@/lib/busqueda-v2/motor";
import { contarConsulta } from "@/lib/busqueda-v2/motor-servidor";
import { COOKIE_RESUMEN, valorCookieResumen } from "@/lib/busqueda-v2/resumen";
import { planParaBuscar } from "@/lib/busqueda-v2/servidor";

/**
 * GET /buscar?q=…[&stock=todos] → 307 a la URL final del catálogo (spec
 * búsqueda v2). Sólo al ENVIAR una búsqueda (header, inicio, "sin
 * resultados"), nunca al tipear. Entiende la consulta (caché, o Entender con
 * Jev en paralelo con el conteo clásico) y redirige ANTES de renderizar: la
 * página del catálogo nunca redirige en el render (sin el parpadeo de "No
 * encontramos…" ni la doble página de la fase 1).
 *
 * Con el flag `busqueda-ia` apagado o un código, 307 a `/catalogo?q=…` (la
 * búsqueda clásica). La decisión vive en lib/busqueda-v2/buscar.ts.
 */
export async function GET(request: NextRequest) {
  // Por request: el flag y la caché se evalúan en cada pedido.
  await connection();
  const sp = request.nextUrl.searchParams;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "sin-ip";
  const { href, resumen } = await destinoDeBusqueda(
    { q: sp.get("q"), stock: sp.get("stock") },
    {
      habilitada: busquedaIaHabilitada,
      plan: async (q) => {
        const { soloVisibles } = await flagsPublicos();
        return planParaBuscar(q, { soloVisibles, ip, diferir: (tarea) => after(tarea) });
      },
      contarClasica: async (base) => {
        const [{ soloVisibles }, disp] = await Promise.all([flagsPublicos(), dispCatalogo()]);
        return contarConsulta({ consulta: base.query ?? "", filtros: sinTexto(filtrosDeEstado(base)), soloVisibles, disp });
      },
    },
  );
  const respuesta = NextResponse.redirect(new URL(href, request.url), 307);
  respuesta.headers.set("Cache-Control", "private, no-store");
  // Para el evento `busqueda_enviada` de la página (sin la consulta; ver resumen.ts).
  if (resumen) {
    respuesta.cookies.set(COOKIE_RESUMEN, valorCookieResumen(resumen), { path: "/", maxAge: 60, sameSite: "lax" });
  }
  return respuesta;
}
