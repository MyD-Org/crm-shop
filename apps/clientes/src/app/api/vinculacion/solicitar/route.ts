import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { solicitarVinculacion } from "@/lib/vinculacion";

export const dynamic = "force-dynamic";

/**
 * POST /api/vinculacion/solicitar — Body: { documento } (acepta `cuit` por compatibilidad)
 *
 * Manda un código al email que ya está cargado en Alegra para ese documento
 * (CUIT, DNI, CPF, CNPJ, CI o RUC).
 * Exige sesión de Clerk: la vinculación siempre se ata a una cuenta concreta.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: { documento?: unknown; cuit?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const raw = body.documento ?? body.cuit;
  const documento = typeof raw === "string" ? raw.trim().slice(0, 20) : "";
  if (!documento) {
    return NextResponse.json({ error: "Falta el documento." }, { status: 400 });
  }

  const resultado = await solicitarVinculacion(userId, documento);

  if (!resultado.ok) {
    // Ninguno de estos motivos depende de si el CUIT consultado existe —ver el
    // bloque de RESPUESTA UNIFORME en lib/vinculacion.ts—, así que se pueden
    // devolver distinguidos sin filtrar la cartera de clientes.
    const status =
      resultado.motivo === "rate_limit"
        ? 429
        : resultado.motivo === "servicio_caido"
          ? 503
          : resultado.motivo === "vinculada_a_otro"
            ? 409
            : 400;
    return NextResponse.json(
      { error: resultado.detalle, motivo: resultado.motivo },
      { status },
    );
  }

  return NextResponse.json(resultado);
}
