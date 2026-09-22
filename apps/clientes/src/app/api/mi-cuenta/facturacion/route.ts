import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  PAIS_DEFAULT,
  PAIS_LABEL,
  TIPO_DOC_LABEL,
  TIPOS_DOC_POR_PAIS,
  telefonoValido,
  validarFacturacion,
  type CondicionIva,
  type Pais,
  type TipoDoc,
} from "@/lib/facturacion";
import {
  actualizarTelefono,
  getPerfilFacturacion,
  guardarPerfilFacturacion,
} from "@/lib/facturacion-db";

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

  // Sin país (clientes viejos del formulario) se asume Argentina. Un país
  // desconocido se deja pasar tal cual para que lo rechace el validador.
  const pais = (texto(body.pais, 2) || PAIS_DEFAULT) as Pais;
  const tipoDocRecibido = texto(body.tipoDoc, 10);

  const datos = {
    pais,
    // Sin un tipo conocido se asume el primero del país, que es el criterio
    // más estricto (CUIT en Argentina). Uno conocido pero de otro país pasa
    // tal cual: lo rechaza el validador con su mensaje.
    tipoDoc: (tipoDocRecibido in TIPO_DOC_LABEL
      ? tipoDocRecibido
      : (TIPOS_DOC_POR_PAIS[pais] ?? TIPOS_DOC_POR_PAIS[PAIS_DEFAULT])[0]) as TipoDoc,
    nroDoc: texto(body.nroDoc, 20),
    razonSocial: texto(body.razonSocial, 160),
    condicionIva: (pais in PAIS_LABEL && pais !== "AR"
      ? "consumidor_final"
      : texto(body.condicionIva, 40)) as CondicionIva,
    domicilioCalle: texto(body.domicilioCalle, 160),
    domicilioCiudad: texto(body.domicilioCiudad, 80),
    domicilioProvincia: texto(body.domicilioProvincia, 80),
    domicilioCp: texto(body.domicilioCp, 12),
    telefono: texto(body.telefono, 40),
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

/**
 * PATCH /api/mi-cuenta/facturacion — cambia solo el teléfono de contacto.
 *
 * Es la única edición que se permite sobre un perfil vinculado a Alegra: el
 * resto lo manda el sistema, pero a quién llamar por un pedido lo decide el
 * cliente. Sin perfil no hay dónde guardarlo (409): primero los datos fiscales.
 */
export async function PATCH(req: Request) {
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

  const telefono =
    typeof body.telefono === "string" ? body.telefono.trim().slice(0, 40) : "";
  if (!telefono || !telefonoValido(telefono)) {
    return NextResponse.json(
      {
        error: "Revise el teléfono.",
        errores: { telefono: "Ingrese un teléfono válido, con código de área." },
      },
      { status: 400 },
    );
  }

  try {
    const perfil = await actualizarTelefono(userId, telefono);
    if (!perfil) {
      return NextResponse.json(
        { error: "Cargue primero sus datos de facturación." },
        { status: 409 },
      );
    }
    return NextResponse.json(perfil);
  } catch (err) {
    console.error("[/api/mi-cuenta/facturacion] PATCH error:", err);
    return NextResponse.json(
      { error: "No pudimos guardar el teléfono. Inténtelo de nuevo." },
      { status: 500 },
    );
  }
}
