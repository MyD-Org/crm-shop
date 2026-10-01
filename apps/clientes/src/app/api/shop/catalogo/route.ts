import { NextRequest, NextResponse } from "next/server";
import { getCatalogo, getPaginaCatalogo } from "@/lib/catalog";
import type { Product } from "@/data/products";
import { busquedaIaHabilitada } from "@/lib/busqueda-ia-flag";
import { atributosEstructuradosDisponibles } from "@/lib/catalogo-atributos-disponibles";
import { pareceCodigo } from "@/lib/busqueda-inteligente/gate";
import { criterioDe } from "@/lib/busqueda-v2/destino";
import { planParaPagina } from "@/lib/busqueda-v2/servidor";
import type { ContextoDisponibilidad } from "@/lib/disponibilidad-contexto";
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
    // Sin caché a propósito: cada texto buscado sería una entrada nueva.
    const [{ soloVisibles }, disp, conBusquedaIa] = await Promise.all([
      flagsPublicos(),
      dispCatalogo(),
      busquedaIaHabilitada(),
    ]);
    // Con el flag `busqueda-ia`, el desplegable busca igual que el Enter (`/buscar` → `?ia=1`):
    // con el plan de la consulta. Si no, "panel de interior" no encontraba nada por texto exacto y
    // la tolerante traía "Pantalla … Apta Exterior", mientras que el Enter mostraba paneles.
    if (q && conBusquedaIa && !pareceCodigo(q)) {
      const conPlan = await buscarConPlan(q, limit, soloVisibles, disp).catch((err: unknown) => {
        console.error("[/api/shop/catalogo] falló la búsqueda con plan:", err);
        return null;
      });
      if (conPlan?.length) return NextResponse.json(conPlan);
    }
    const productos = await getCatalogo({ busqueda: q, limit, soloVisibles, disp });
    // Sin resultados: segundo intento tolerante a errores de tipeo (mismo
    // criterio que la page del catálogo). Si falla, se devuelve lo exacto.
    if (q && productos.length === 0) {
      const parecidos = await getCatalogo({ busqueda: q, limit, soloVisibles, tolerante: true, disp }).catch(
        (err: unknown) => {
          console.error("[/api/shop/catalogo] falló la búsqueda tolerante:", err);
          return productos;
        },
      );
      return NextResponse.json(parecidos);
    }
    return NextResponse.json(productos);
  } catch (err) {
    console.error("[/api/shop/catalogo] error:", err);
    return NextResponse.json(
      { error: "No se pudo cargar el catálogo" },
      { status: 502 }
    );
  }
}

/** Mismo criterio que `/catalogo?ia=1` (ver `app/catalogo/page.tsx`); null si no hay plan. */
async function buscarConPlan(
  q: string,
  limit: number,
  soloVisibles: boolean,
  disp: ContextoDisponibilidad | undefined,
): Promise<Product[] | null> {
  const [plan, estructurados] = await Promise.all([
    planParaPagina(q, { soloVisibles }),
    atributosEstructuradosDisponibles(),
  ]);
  if (!plan || plan.intencion === "codigo") return null;
  const pagina = await getPaginaCatalogo({
    filtros: {
      busqueda: q,
      planBusqueda: criterioDe(plan, { categorias: [], atributos: [] }),
      ...(estructurados ? { atributosEstructurados: true } : {}),
    },
    orden: "relevancia",
    porPagina: limit,
    soloVisibles,
    disp,
  });
  return pagina.productos;
}
