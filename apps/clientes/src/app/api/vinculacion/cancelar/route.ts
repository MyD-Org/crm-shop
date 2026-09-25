import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cancelarVinculacion } from "@/lib/vinculacion";

/**
 * POST /api/vinculacion/cancelar
 *
 * El cliente dijo que la cuenta encontrada no es la suya: se anulan sus códigos
 * pendientes y no se vincula nada.
 */
export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  await cancelarVinculacion(userId);
  return NextResponse.json({ ok: true });
}
