import { NextRequest, NextResponse } from "next/server";
import { getCatalogo } from "@/lib/catalog";

// Lee de Alegra en cada request (datos de gestión, no cacheables estáticamente).
export const dynamic = "force-dynamic";

/** Alegra limita las consultas a 30 items por request. */
const MAX_LIMIT = 30;

/**
 * GET /api/shop/catalogo?q=<texto>&limit=<n>
 * Devuelve Product[] mapeado desde Alegra. Solo lectura.
 * Lo consumen el buscador (autocomplete) y los destacados del home.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const limitRaw = Number(searchParams.get("limit"));
  const limit = Math.min(
    Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : MAX_LIMIT,
    MAX_LIMIT
  );

  try {
    const productos = await getCatalogo({ busqueda: q, limit });
    return NextResponse.json(productos);
  } catch (err) {
    console.error("[/api/shop/catalogo] error:", err);
    return NextResponse.json(
      { error: "No se pudo cargar el catálogo" },
      { status: 502 }
    );
  }
}
