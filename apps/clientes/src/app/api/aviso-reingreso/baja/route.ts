import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { bajaPorToken } from "@/lib/aviso-reingreso-repo";
import { shopTenantId } from "@/lib/tenant";

/**
 * Baja de un clic del aviso de reingreso (RFC 8058): el cliente de correo hace POST al enlace de la
 * cabecera `List-Unsubscribe` con `List-Unsubscribe=One-Click` en el cuerpo. Sin sesión: el token del
 * enlace (32 bytes aleatorios) es la credencial. Idempotente. No mira el flag `aviso-reingreso`: los
 * avisos ya creados siempre pueden darse de baja. Solo POST: un GET (precarga de enlaces) no modifica nada.
 */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token")?.trim() ?? "";
  try {
    const existe = await bajaPorToken(getDb(), shopTenantId(), token);
    if (!existe) return NextResponse.json({ ok: false, error: "Enlace no válido" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[aviso-reingreso/baja] error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "No se pudo procesar la baja" }, { status: 500 });
  }
}
