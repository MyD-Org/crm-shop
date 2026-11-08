import { connection } from "next/server";
import { productosParaFeed } from "@/lib/catalogo-publico";
import { feedGoogleXml } from "@/lib/feed-google";
import { flagsPublicos } from "@/lib/flags-publicos";
import { esSitioSecundarioDelEntorno, urlCanonicaDelSitio } from "@/lib/sitio-url";

/**
 * GET /feed/google.xml — catálogo publicado para Google Merchant Center (lo lee una vez por día).
 * Mismo criterio que el sitemap: sólo en el sitio principal (las URLs del feed tienen que ser de
 * ese dominio) y los mismos productos que el catálogo público.
 */
export async function GET() {
  // Por request: sin esto el build podría prerenderizar la respuesta.
  await connection();
  const sitio = urlCanonicaDelSitio();
  if (esSitioSecundarioDelEntorno() || !sitio) return new Response("No encontrado", { status: 404 });
  try {
    const { soloVisibles, variantes } = await flagsPublicos();
    const productos = await productosParaFeed(soloVisibles, variantes);
    return new Response(feedGoogleXml(productos, sitio), {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=3600",
      },
    });
  } catch (err) {
    console.error("[/feed/google.xml] error:", err);
    return new Response("No se pudo generar el feed", { status: 502 });
  }
}
