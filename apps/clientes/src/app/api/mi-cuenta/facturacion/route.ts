import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { claveSolicitante, identidadActual } from "@/lib/auth";
import { validarComplemento } from "@/lib/contacto-alegra";
import { completarEnAlegra } from "@/lib/contacto-write-through";
import { datosDelContacto } from "@/lib/datos-del-contacto";
import { provinciaCanonica } from "@/lib/provincias";
import { permitir } from "@/lib/rate-limit";
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

/** Cada completado del vinculado gasta cuota de /contacts de Alegra (~5/min, compartida). */
const COMPLETAR_POR_MINUTO = 3;

/**
 * PUT /api/mi-cuenta/facturacion — datos de facturación.
 *
 * - No vinculado (Clerk): crea o actualiza el perfil. Los datos son
 *   declarativos: el cliente dice a nombre de quién quiere la factura. No
 *   otorgan nada — ni lista de precios ni cuenta corriente. Eso lo da la
 *   vinculación probada por OTP.
 * - Vinculado (Clerk o cookie del CRM): el cuerpo es el COMPLEMENTO del modal
 *   del checkout. Sólo se aceptan campos vacíos en Alegra (D1): se escriben en
 *   Alegra y en el espejo; si Alegra falla, al perfil (Clerk) o de vuelta al
 *   checkout para ir con el pedido (cookie). Ver `completarVinculado`.
 */
export async function PUT(req: Request) {
  const identidad = await identidadActual();
  const { clerkUserId: userId, cliente } = identidad;
  if (!userId && !cliente) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (cliente) return completarVinculado(identidad, body);
  if (!userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
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
    // En Argentina se elige de la lista: se guarda con el nombre oficial
    // ("caba" ⇒ "Ciudad Autónoma de Buenos Aires"). Uno que no está en la
    // lista pasa tal cual y lo rechaza el validador.
    domicilioProvincia:
      pais === "AR"
        ? (provinciaCanonica(texto(body.domicilioProvincia, 80)) ?? texto(body.domicilioProvincia, 80))
        : texto(body.domicilioProvincia, 80),
    domicilioCp: texto(body.domicilioCp, 12),
    telefono: texto(body.telefono, 40),
  };

  // Se revalida en el servidor con la MISMA función que usa el formulario: si
  // solo validara el cliente, un POST directo metería un CUIT inválido en una
  // factura real.
  const errores = validarFacturacion(datos);
  if (Object.keys(errores).length > 0) {
    return NextResponse.json(
      { error: "Revise los datos de facturación.", errores },
      { status: 400 },
    );
  }

  try {
    const perfil = await guardarPerfilFacturacion(userId, datos);
    return NextResponse.json(perfil);
  } catch (err) {
    console.error("[/api/mi-cuenta/facturacion] error:", err);
    return NextResponse.json(
      { error: "No pudimos guardar sus datos. Inténtelo de nuevo." },
      { status: 500 },
    );
  }
}

/**
 * Completar los datos del comprador vinculado (D-9). Respuestas:
 * 200 `{estado: "alegra" | "perfil" | "sin_cambios"}` o `{estado: "en_pedido",
 * complemento}`; 400 `{errores}`; 409 `{motivo: "campo_de_alegra", campos}`
 * (sin llamar a Alegra); 429; 503 si no se sabe qué tiene Alegra.
 */
async function completarVinculado(
  identidad: Awaited<ReturnType<typeof identidadActual>>,
  body: Record<string, unknown>,
) {
  const clave = (await claveSolicitante()) ?? `cliente:${identidad.cliente?.codigocliente}`;
  if (!permitir(`facturacion:${clave}`, COMPLETAR_POR_MINUTO, 60_000)) {
    return NextResponse.json(
      { error: "Demasiados intentos. Inténtelo de nuevo en un minuto." },
      { status: 429 },
    );
  }

  try {
    const dc = await datosDelContacto(identidad);
    if (!dc.interno || !dc.alegraId) {
      return NextResponse.json(
        { error: "No pudimos obtener sus datos de facturación. Inténtelo de nuevo en unos minutos." },
        { status: 503 },
      );
    }

    const r = validarComplemento(dc.interno.lectura, body);
    if (!r.ok && r.motivo === "campo_de_alegra") {
      return NextResponse.json(
        {
          error:
            "Ese dato ya figura en su cuenta y no puede modificarse desde la tienda. Si no es correcto, escríbanos.",
          motivo: "campo_de_alegra",
          campos: r.campos,
        },
        { status: 409 },
      );
    }
    if (!r.ok) {
      return NextResponse.json(
        { error: "Revise los datos de facturación.", errores: r.motivo === "invalido" ? r.errores : {} },
        { status: 400 },
      );
    }
    if (Object.keys(r.complemento).length === 0) {
      return NextResponse.json({ estado: "sin_cambios" });
    }

    const resultado = await completarEnAlegra({
      alegraId: dc.alegraId,
      base: dc.interno.base,
      datos: r.datos,
      complemento: r.complemento,
      clerkUserId: identidad.clerkUserId,
    });
    return NextResponse.json(resultado);
  } catch (err) {
    const codigo = (err as { code?: unknown })?.code;
    console.error(`[/api/mi-cuenta/facturacion] completar falló (${codigo ?? "sin código"})`);
    return NextResponse.json(
      { error: "No pudimos guardar sus datos. Inténtelo de nuevo." },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/mi-cuenta/facturacion — cambia solo el teléfono de contacto.
 *
 * Es la única edición que se permite sobre un perfil vinculado a Alegra: el
 * resto lo manda el sistema, pero a quién llamar por un pedido lo decide el
 * cliente. Sin perfil se crea una fila "sólo teléfono" (0009): el vinculado
 * factura con el espejo y no tiene por qué tener perfil.
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
    return NextResponse.json(await actualizarTelefono(userId, telefono));
  } catch (err) {
    console.error("[/api/mi-cuenta/facturacion] PATCH error:", err);
    return NextResponse.json(
      { error: "No pudimos guardar el teléfono. Inténtelo de nuevo." },
      { status: 500 },
    );
  }
}
