import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { validarFacturacion, type CondicionIva, type TipoDoc } from "@/lib/facturacion";
import { getPerfilFacturacion, guardarPerfilFacturacion } from "@/lib/facturacion-db";

export const dynamic = "force-dynamic";

/** GET /api/mi-cuenta/facturacion — perfil del usuario logueado. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return NextResponse.json(await getPerfilFacturacion(userId));
}

/**
 * PUT /api/mi-cuenta/facturacion — crea o actualiza el perfil.
 *
 * Los datos son declarativos: el cliente dice a nombre de quién quiere la
 * factura. No otorgan nada — ni lista de precios ni cuenta corriente. Eso lo da
 * la vinculación probada por OTP.
 */
export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const texto = (v: unknown, max = 120) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";

  const datos = {
    tipoDoc: (body.tipoDoc === "DNI" ? "DNI" : "CUIT") as TipoDoc,
    nroDoc: texto(body.nroDoc, 20),
    razonSocial: texto(body.razonSocial, 160),
    condicionIva: texto(body.condicionIva, 40) as CondicionIva,
    domicilioCalle: texto(body.domicilioCalle, 160),
    domicilioCiudad: texto(body.domicilioCiudad, 80),
    domicilioProvincia: texto(body.domicilioProvincia, 80),
    domicilioCp: texto(body.domicilioCp, 12),
  };

  // Se revalida en el servidor con la MISMA función que usa el formulario: si
  // solo validara el cliente, un POST directo metería un CUIT inválido en una
  // factura real.
  const errores = validarFacturacion(datos);
  if (Object.keys(errores).length > 0) {
    return NextResponse.json(
      { error: "Revisá los datos de facturación.", errores },
      { status: 400 },
    );
  }

  try {
    const perfil = await guardarPerfilFacturacion(userId, datos);
    return NextResponse.json(perfil);
  } catch (err) {
    console.error("[/api/mi-cuenta/facturacion] error:", err);
    return NextResponse.json(
      { error: "No pudimos guardar tus datos. Probá de nuevo." },
      { status: 500 },
    );
  }
}
