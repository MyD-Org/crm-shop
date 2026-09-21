import { NextResponse } from "next/server";
import { SECCIONES_HOME, erroresSeccion } from "@/data/home-defaults";
import { guardarSeccionHome, borrarSeccionHome } from "@/lib/home-guardar";
import { bearerMatches } from "@/lib/secure-compare";

export const dynamic = "force-dynamic";

/**
 * Puerta de escritura del CRM hacia el contenido de la home del shop.
 * Mismo contrato de auth que /api/internal/cuotas/revalidar: Bearer
 * SHOP_CRM_SECRET. Body: { key, payload } — ver SECCIONES_HOME en
 * src/data/home-defaults.
 */
export async function PUT(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.SHOP_CRM_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body inválido: se esperaba JSON" }, { status: 400 });
  }

  const { key, payload } = (body ?? {}) as { key?: unknown; payload?: unknown };

  if (typeof key !== "string" || !(SECCIONES_HOME as readonly string[]).includes(key)) {
    return NextResponse.json(
      { error: "key inválida", detalles: [`sección desconocida: ${key} (key debe ser una de: ${SECCIONES_HOME.join(", ")})`] },
      { status: 400 },
    );
  }

  // navBadge: null = apagar el badge (borrar la fila → vuelve al default null).
  if (key === "navBadge" && payload === null) {
    await borrarSeccionHome(key);
    return NextResponse.json({ ok: true, key, updatedAt: null });
  }

  const detalles = erroresSeccion(key, payload);
  if (detalles.length > 0) {
    return NextResponse.json({ error: "payload inválido", detalles }, { status: 400 });
  }

  const guardado = await guardarSeccionHome(key, payload);
  return NextResponse.json({ ok: true, key, updatedAt: guardado.updatedAt });
}
