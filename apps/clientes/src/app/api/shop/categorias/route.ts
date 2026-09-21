import { NextResponse } from "next/server";
import { getCategorias } from "@/lib/catalog";

// Sale del espejo local de categorías (lo refresca el cron diario).
export const dynamic = "force-dynamic";

/**
 * GET /api/shop/categorias
 * Categorías del catálogo completo, para navegación. Solo lectura.
 * Lo consume el home para armar la grilla de categorías.
 */
export async function GET() {
  try {
    const categorias = await getCategorias();
    return NextResponse.json({ categorias });
  } catch (err) {
    console.error("[/api/shop/categorias] error:", err);
    return NextResponse.json(
      { error: "No se pudieron cargar las categorías" },
      { status: 502 }
    );
  }
}
