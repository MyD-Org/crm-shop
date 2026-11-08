import { connection } from "next/server";
import { getPaginasPublicadas } from "@/lib/institucional/datos";
import { llmsTxt } from "@/lib/llms-txt";
import { getMarca } from "@/lib/marca";
import { baseDelSitio } from "@/lib/seo";
import {
  esSitioSecundarioDelEntorno,
  urlCanonicaDelSitio,
} from "@/lib/sitio-url";

/**
 * GET /llms.txt — resumen del sitio para agentes de IA (lo audita PageSpeed en
 * "Navegación agéntica"). Como el sitemap y el feed: sólo en el sitio principal.
 */
export async function GET() {
  await connection();
  const base = baseDelSitio(urlCanonicaDelSitio());
  if (esSitioSecundarioDelEntorno() || !base)
    return new Response("No encontrado", { status: 404 });
  const [marca, paginas] = await Promise.all([
    getMarca(),
    getPaginasPublicadas(),
  ]);
  return new Response(
    llmsTxt({
      nombre: marca.nombre,
      descripcion: marca.descripcion,
      base,
      paginas,
    }),
    {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, s-maxage=3600",
      },
    },
  );
}
