import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { solicitarVinculacion } from "@/lib/vinculacion";

export const dynamic = "force-dynamic";

/**
 * POST /api/vinculacion/solicitar — Body: { cuit }
 *
 * Manda un código al email que ya está cargado en Alegra para ese CUIT.
 * Exige sesión de Clerk: la vinculación siempre se ata a una cuenta concreta.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { cuit?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const cuit = typeof body.cuit === "string" ? body.cuit.trim().slice(0, 20) : "";
  if (!cuit) {
    return NextResponse.json({ error: "Falta el CUIT." }, { status: 400 });
  }

  const resultado = await solicitarVinculacion(userId, cuit);

  if (!resultado.ok) {
    // 429 solo para el rate limit; el resto es 400 con el detalle, que está
    // redactado para poder mostrarse tal cual.
    const status = resultado.motivo === "rate_limit" ? 429 : 400;
    return NextResponse.json(
      { error: resultado.detalle, motivo: resultado.motivo },
      { status },
    );
  }

  return NextResponse.json(resultado);
}
