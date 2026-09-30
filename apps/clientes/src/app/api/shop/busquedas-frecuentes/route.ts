import { connection, NextResponse } from "next/server";
import { busquedaIaHabilitada } from "@/lib/busqueda-ia-flag";
import { busquedasFrecuentesCacheadas } from "@/lib/busqueda-inteligente/frecuentes";
import { shopTenantId } from "@/lib/tenant";

/**
 * GET /api/shop/busquedas-frecuentes → `{ busquedas: string[] }`
 *
 * "Búsquedas frecuentes" de la guía del buscador (flag `busqueda-ia`): las
 * consultas con más usos en 30 días y resultado no vacío, de la caché de
 * interpretaciones. Iguales para todos: cacheadas una hora en el servidor.
 * Con el flag apagado, 404. Si la caché no responde, lista vacía (nunca error:
 * la guía se muestra igual, sin esa sección).
 */
export async function GET() {
  // Por request: el flag se evalúa en cada pedido (sin esto el build podría
  // prerenderizar la respuesta).
  await connection();
  if (!(await busquedaIaHabilitada())) {
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  }
  try {
    const busquedas = await busquedasFrecuentesCacheadas(shopTenantId());
    return NextResponse.json({ busquedas }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    console.error(`[/api/shop/busquedas-frecuentes] ${err instanceof Error ? err.name : "desconocido"}`);
    return NextResponse.json({ busquedas: [] });
  }
}
