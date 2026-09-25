import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { confirmarVinculacion } from "@/lib/vinculacion";

/**
 * POST /api/vinculacion/confirmar — Body: { codigo }
 *
 * Revalida el código y crea la vinculación, después de que el cliente confirmó
 * la cuenta que le mostró `/verificar`. A partir de acá el cliente ve su
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
  // Solo un email VERIFICADO se anota en las observaciones del contacto de
  // Alegra (ver `registrarEmailAlternativo`): uno sin verificar no prueba que
  // esta persona lo use.
  const user = await currentUser();
  const primario = user?.primaryEmailAddress;
  const emailVerificado =
    primario?.verification?.status === "verified" ? primario.emailAddress : undefined;

  const resultado = await confirmarVinculacion(userId, codigo, emailVerificado);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.detalle }, { status: 400 });
  }

  return NextResponse.json(resultado);
}
