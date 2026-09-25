import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { verificarCodigo } from "@/lib/vinculacion";

/**
 * POST /api/vinculacion/verificar — Body: { codigo }
 *
 * Valida el código y devuelve a qué cuenta de cliente corresponde, para que el
 * cliente la confirme antes de vincular. No vincula ni consume el código.
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
  const resultado = await verificarCodigo(userId, codigo);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.detalle }, { status: 400 });
  }

  return NextResponse.json(resultado);
}
