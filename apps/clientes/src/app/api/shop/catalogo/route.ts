import { NextRequest, NextResponse } from "next/server";
import { getCatalogo } from "@/lib/catalog";

// Lee el espejo local del catálogo en cada request.
export const dynamic = "force-dynamic";

/**
 * Tope de resultados. Ya no es el límite de Alegra (el espejo local no lo
 * tiene): es para que el autocomplete y los destacados del home no se traigan
 * el catálogo entero sin querer.
 */
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 200;

/**
 * GET /api/shop/catalogo?q=<texto>&limit=<n>
 * Devuelve Product[] desde el espejo local. Solo lectura.
 * Lo consumen el buscador (autocomplete) y los destacados del home.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const limitRaw = Number(searchParams.get("limit"));
  const limit = Math.min(
    Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT,
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
