import { NextResponse } from "next/server";
import { getProducto } from "@/lib/catalog";

// Lee de Alegra en cada request (datos de gestión, no cacheables estáticamente).
export const dynamic = "force-dynamic";

/**
 * GET /api/shop/producto/<id>
 * Devuelve un Product mapeado desde Alegra, o 404 si no existe. Solo lectura.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const producto = await getProducto(id);
    if (!producto) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      );
    }
    return NextResponse.json(producto);
  } catch (err) {
    console.error(`[/api/shop/producto/${id}] error:`, err);
    return NextResponse.json(
      { error: "No se pudo cargar el producto" },
      { status: 502 }
    );
  }
}
