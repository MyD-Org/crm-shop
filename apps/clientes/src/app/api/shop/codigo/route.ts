import { NextRequest, NextResponse } from "next/server";
import { getProductosPorSkus } from "@/lib/catalog";
import { flagsPublicos } from "@/lib/flags-publicos";
import { dispCatalogo } from "@/lib/zona-servidor";

/** Más largo que cualquier referencia de Alegra o EAN: lo demás no es un código. */
const MAX_LARGO = 64;

/**
 * GET /api/shop/codigo?c=<código>
 *
 * El escáner del buscador: el código leído (de barras o el texto de un QR que no es un link de la
 * tienda) contra el código del producto, exacto y sin mayúsculas (`code` o `name` de Alegra, ver
 * `getProductosPorSkus`). Con los mismos filtros que la lista pública: un producto que el
 * visitante no vería no sale. Responde `{ id }` si hay uno solo; si no hay ninguno (o hay más de
 * uno) `{ id: null }` y el buscador cae a la búsqueda normal con ese texto (que encuentra, por
 * ejemplo, la referencia que la etiqueta imprimió sin el sufijo de marca).
 */
export async function GET(req: NextRequest) {
  const c = req.nextUrl.searchParams.get("c")?.trim() ?? "";
  if (!c || c.length > MAX_LARGO) return NextResponse.json({ id: null });

  try {
    const [{ soloVisibles, variantes }, disp] = await Promise.all([flagsPublicos(), dispCatalogo()]);
    const productos = await getProductosPorSkus([c], { soloVisibles, ...(variantes ? { agrupar: true } : {}), disp });
    return NextResponse.json({ id: productos.length === 1 ? productos[0].id : null });
  } catch (err) {
    console.error("[/api/shop/codigo] error:", err);
    return NextResponse.json({ error: "No se pudo buscar el código." }, { status: 502 });
  }
}
