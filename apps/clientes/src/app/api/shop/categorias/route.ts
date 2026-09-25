import { connection, NextResponse } from "next/server";
import { getCategorias } from "@/lib/catalog";
import { flagsPublicos } from "@/lib/flags-publicos";

/**
 * GET /api/shop/categorias
 * Categorías del catálogo completo, para navegación. Solo lectura.
 * Lo consume el home para armar la grilla de categorías.
 */
export async function GET() {
  // Por request: sin esto el build podría prerenderizar la respuesta.
  await connection();
  try {
    const { soloVisibles } = await flagsPublicos();
    const categorias = await getCategorias(soloVisibles);
    return NextResponse.json({ categorias });
  } catch (err) {
    console.error("[/api/shop/categorias] error:", err);
    return NextResponse.json(
      { error: "No se pudieron cargar las categorías" },
      { status: 502 }
    );
  }
}
