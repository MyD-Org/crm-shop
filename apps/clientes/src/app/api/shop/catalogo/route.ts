import { NextRequest, NextResponse } from "next/server";
import { busquedaIaHabilitada } from "@/lib/busqueda-ia-flag";
import { usarAtributosEstructurados } from "@/lib/catalogo-atributos-uso";
import { buscarEnShop } from "@/lib/busqueda-v2/motor-servidor";
import { flagsPublicos } from "@/lib/flags-publicos";
import { dispCatalogo } from "@/lib/zona-servidor";

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
 *
 * La búsqueda es la del motor único (`busqueda-v2/motor.ts`, superficie `autocompletar`): con el
 * flag `busqueda-ia`, el desplegable busca igual que el Enter (`/buscar` → `?ia=1`), con el plan
 * de la consulta; si no encuentra nada, la búsqueda exacta y, al final, la tolerante a errores de
 * tipeo. Sin caché a propósito: cada texto buscado sería una entrada nueva.
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
    const [{ soloVisibles }, disp, conBusquedaIa, estructurados] = await Promise.all([
      flagsPublicos(),
      dispCatalogo(),
      busquedaIaHabilitada(),
      // Sólo lo usa el camino con plan (los atributos estructurados de cada producto).
      usarAtributosEstructurados(),
    ]);
    const resultado = await buscarEnShop(
      {
        consulta: q,
        filtros: estructurados ? { atributosEstructurados: true } : {},
        orden: "relevancia",
        pagina: 1,
        porPagina: limit,
      },
      { superficie: "autocompletar", soloVisibles, disp, busquedaIa: conBusquedaIa },
    );
    return NextResponse.json(resultado.productos);
  } catch (err) {
    console.error("[/api/shop/catalogo] error:", err);
    return NextResponse.json(
      { error: "No se pudo cargar el catálogo" },
      { status: 502 }
    );
  }
}
