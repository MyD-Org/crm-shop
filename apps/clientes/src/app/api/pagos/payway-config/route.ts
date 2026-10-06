import { NextResponse } from "next/server";
import { identidadActual } from "@/lib/auth";
import { paywayConfigPublica } from "@/lib/pagos/payway";

/**
 * GET /api/pagos/payway-config — lo que el formulario de tarjeta necesita para tokenizar en el
 * navegador: la API key PÚBLICA de Payway (sirve sólo para crear tokens) y la base de la API.
 *
 * Sale del servidor en cada request en vez de una variable `NEXT_PUBLIC_*`: no exige otra variable ni
 * un rebuild al rotarla. Pide sesión (el checkout también). Nunca devuelve la key privada.
 */
export async function GET() {
  const { clerkUserId, cliente } = await identidadActual();
  if (!clerkUserId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const config = paywayConfigPublica();
  if (!config) {
    return NextResponse.json(
      { error: "Los pagos en línea no están disponibles en este momento. Un asesor coordinará el pago con usted." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(config, { headers: { "Cache-Control": "no-store" } });
}
