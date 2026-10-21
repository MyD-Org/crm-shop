import { connection } from "next/server";
import { ProductCardSkeleton } from "@myd-org/ui";
import { ProductosCarrusel } from "@/components/ProductosCarrusel";
import { TarjetaProductoCarrusel } from "@/components/TarjetaProductoCarrusel";
import { destacadosHome, facetasPublicas, paginaMarcaPublica } from "@/lib/catalogo-publico";
import { atributosEstructuradosDisponibles } from "@/lib/catalogo-atributos-disponibles";
import { filtrosPorTipo } from "@/lib/catalogo-car";
import { filtrosDeEstado } from "@/lib/catalogo-url";
import { estadoCatalogoDeMarca } from "@/lib/marcas/estado-marca";
import { flagsPublicos } from "@/lib/flags-publicos";
import type { ElegidosMarca, PaginaMarca } from "@/lib/marcas/pagina-marca";
import { filtrosDeMarca } from "@/lib/marcas/vista-marca";
import { dispCatalogo } from "@/lib/zona-servidor";
import { ProductosMarcaClient } from "../ProductosMarcaClient";
import { SeccionMarca, TituloBloque } from "./BloquesMarca";

/**
 * Bloques de una página de marca que leen el catálogo: huecos por request (los
 * flags y la zona se evalúan acá, nunca en el shell), como `DestacadosHome`.
 * Los productos salen de la caché compartida del catálogo (tag `catalogo`).
 */

async function contexto() {
  await connection();
  const [{ soloVisibles, variantes, mediosPrecio }, disp] = await Promise.all([flagsPublicos(), dispCatalogo()]);
  return {
    soloVisibles,
    ...(variantes ? { agrupar: true } : {}),
    disp,
    destacado: mediosPrecio?.destacado,
    cuotas: mediosPrecio?.cuotas,
  };
}

/** Total de productos de la marca (para "Ver los N productos"); null si el catálogo falla. */
export async function totalProductosMarca(pagina: PaginaMarca): Promise<number | null> {
  try {
    const ctx = await contexto();
    return (await paginaMarcaPublica({ ...ctx, filtros: filtrosDeMarca(pagina), orden: "destacados", pagina: 1 })).total;
  } catch (err) {
    console.error("[marcas] no se pudo contar los productos:", err);
    return null;
  }
}

export async function ElegidosMarcaBloque({ pagina, elegidos }: { pagina: PaginaMarca; elegidos: ElegidosMarca }) {
  const productos = await destacadosHome({
    ...(await contexto()),
    skus: elegidos.skus,
    cantidad: elegidos.cantidad,
    base: filtrosDeMarca(pagina),
  });
  if (productos.length === 0) return null;
  return (
    <SeccionMarca>
      <TituloBloque>{elegidos.titulo}</TituloBloque>
      <ProductosCarrusel label={elegidos.titulo}>
        {productos.map((p) => (
          <TarjetaProductoCarrusel key={p.id} producto={p} />
        ))}
      </ProductosCarrusel>
    </SeccionMarca>
  );
}

export function ElegidosMarcaSkeleton({ cantidad }: { cantidad: number }) {
  return (
    <SeccionMarca>
      <ProductosCarrusel label="Cargando productos">
        {Array.from({ length: Math.min(Math.max(cantidad, 1), 4) }, (_, i) => (
          <ProductCardSkeleton key={i} variant="editorial" className="h-full" />
        ))}
      </ProductosCarrusel>
    </SeccionMarca>
  );
}

/**
 * "Todos los productos": la línea completa (sin filtro de stock por defecto) con el panel de
 * filtros del catálogo (categoría, precio, características, stock, orden y vista), chips por
 * línea y paginación con enlaces reales. Los filtros viajan en la URL de la página de la marca
 * (`estado-marca.ts`); lo interactivo vive en `ProductosMarcaClient`.
 */
export async function ProductosMarcaBloque({
  pagina,
  titulo,
  query,
  linea,
}: {
  pagina: PaginaMarca;
  titulo?: string;
  /** Los search params crudos de la página. */
  query: Record<string, string | string[] | undefined>;
  /** La línea vigente (ya validada contra las líneas de la página). */
  linea?: string;
}) {
  const [ctx, tablaLegible] = await Promise.all([contexto(), atributosEstructuradosDisponibles()]);
  const estado = estadoCatalogoDeMarca(query);
  const filtros = {
    ...filtrosDeEstado(estado),
    ...filtrosPorTipo(tablaLegible, estado.caracteristicas),
    ...filtrosDeMarca(pagina, linea),
    marcas: [],
    sinFacetaAtributos: true as const,
  };
  const [resultado, facetas] = await Promise.all([
    paginaMarcaPublica({ ...ctx, filtros, orden: estado.orden, pagina: estado.pagina }),
    ctx.agrupar ? facetasPublicas(filtros, ctx.soloVisibles, ctx.disp, true) : facetasPublicas(filtros, ctx.soloVisibles, ctx.disp),
  ]);
  return (
    <SeccionMarca id="productos" className="scroll-mt-24">
      <TituloBloque bajada={`${resultado.total} ${resultado.total === 1 ? "producto" : "productos"}`}>
        {titulo || `Todos los productos ${pagina.nombre}`}
      </TituloBloque>
      <ProductosMarcaClient
        slug={pagina.slug}
        linea={linea}
        lineas={pagina.bloques.lineas?.items ?? []}
        productos={resultado.productos}
        // La marca la fija la página: el panel no la ofrece.
        facetas={{ ...facetas, marcas: [] }}
        estado={{ ...estado, pagina: resultado.pagina }}
        paginas={resultado.paginas}
      />
    </SeccionMarca>
  );
}
