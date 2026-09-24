import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/sesion/cerrar
 *
 * Borra la cookie heredada del portal del CRM (`portal-session`). Cerrar sesión
 * en Clerk no la toca, y mientras exista la tienda sigue reconociendo al
 * cliente por ella (ver `identidadActual`): sin esto, quien cierra sesión y
 * vuelve a entrar sigue viendo las facturas de esa cuenta.
 *
 * Sin auth a propósito: solo borra la cookie de quien la manda.
 */
export async function POST() {
  try {
    const sesion = await getIronSession<SessionData>(await cookies(), sessionOptions);
    sesion.destroy();
  } catch {
    // Sin SESSION_SECRET no hay cookie heredada que borrar.
  }
  return new NextResponse(null, { status: 204 });
}
