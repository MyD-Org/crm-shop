import { NextResponse } from "next/server";
import { fetchersCRM, repoCatalogoDrizzle } from "@/lib/catalogo-repo";
import { sincronizarCatalogo } from "@/lib/catalogo-sync-overlay";
import { bearerMatches } from "@/lib/secure-compare";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Aviso del CRM de que algo cambió: vuelve a copiar ya, sin esperar al cron.
 *
 * SIN payload a propósito: el CRM sólo avisa y el Shop re-consulta el contrato, así un aviso no
 * puede inyectar datos. Autenticado con SHOP_CRM_SECRET, la llave propia del Shop.
 *
 * OJO: esta ruta tiene que estar en RUTAS_PUBLICAS del gate (src/proxy.ts). Si no, la cortina de
 * "Próximamente" responde 200 con HTML, el CRM lo toma por éxito y el aviso se pierde en silencio
 * — que es exactamente lo que le viene pasando al ping de cuotas.
 */
export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.SHOP_CRM_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const resultado = await sincronizarCatalogo(
    { repo: repoCatalogoDrizzle(), ...fetchersCRM(), ahora: () => new Date() },
    "ping",
  );

  return NextResponse.json(resultado, { status: resultado.ok ? 200 : 502 });
}
