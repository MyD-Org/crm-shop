import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { confirmarVinculacion } from "@/lib/vinculacion";

export const dynamic = "force-dynamic";

/**
 * POST /api/vinculacion/confirmar — Body: { codigo }
 *
 * Valida el código y crea la vinculación. A partir de acá el cliente ve su
 * lista de precios en el catálogo y el checkout.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { codigo?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const codigo = typeof body.codigo === "string" ? body.codigo.trim() : "";
  const resultado = await confirmarVinculacion(userId, codigo);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.detalle }, { status: 400 });
  }

  return NextResponse.json(resultado);
}
