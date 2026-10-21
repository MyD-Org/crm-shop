import Link from "next/link";
import { connection } from "next/server";
import { ChipRow, Pagination, ProductCardSkeleton } from "@myd-org/ui";
import { ProductosCarrusel } from "@/components/ProductosCarrusel";
import { TarjetaProductoCarrusel } from "@/components/TarjetaProductoCarrusel";
import { linkNext } from "@/components/catalogo/link-next";
import { destacadosHome, paginaMarcaPublica } from "@/lib/catalogo-publico";
import { flagsPublicos } from "@/lib/flags-publicos";
import type { ElegidosMarca, PaginaMarca } from "@/lib/marcas/pagina-marca";
import { filtrosDeMarca, hrefCatalogoCompleto, hrefLinea, hrefPaginaMarca } from "@/lib/marcas/vista-marca";
import { dispCatalogo } from "@/lib/zona-servidor";
import { GrillaProductosMarca } from "../GrillaProductosMarca";
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
 * "Todos los productos": la línea completa (sin filtro de stock), chips por
 * línea, paginación con enlaces reales y la salida al catálogo con filtros.
 */
export async function ProductosMarcaBloque({
  pagina,
  titulo,
  estado,
}: {
  pagina: PaginaMarca;
  titulo?: string;
  estado: { pagina: number; linea?: string };
}) {
  const resultado = await paginaMarcaPublica({
    ...(await contexto()),
    filtros: filtrosDeMarca(pagina, estado.linea),
    orden: "destacados",
    pagina: estado.pagina,
  });
  const lineas = pagina.bloques.lineas?.items ?? [];
  return (
    <SeccionMarca id="productos" className="scroll-mt-24">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <TituloBloque bajada={`${resultado.total} ${resultado.total === 1 ? "producto" : "productos"}`}>
          {titulo || `Todos los productos ${pagina.nombre}`}
        </TituloBloque>
        <Link href={hrefCatalogoCompleto(pagina)} className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
          Ver con todos los filtros →
        </Link>
      </div>
      {lineas.length > 0 ? (
        <ChipRow
          className="mb-6"
          chips={[
            { label: "Todas", href: hrefLinea(pagina.slug) },
            ...lineas.map((l) => ({ label: estado.linea === l.slug ? `✓ ${l.titulo}` : l.titulo, href: hrefLinea(pagina.slug, l.slug) })),
          ]}
        />
      ) : null}
      {resultado.productos.length > 0 ? (
        <GrillaProductosMarca productos={resultado.productos} />
      ) : (
        <p className="py-10 text-center text-base text-muted">No hay productos para mostrar en este momento.</p>
      )}
      {resultado.paginas > 1 ? (
        <Pagination
          className="mt-8"
          page={resultado.pagina}
          totalPages={resultado.paginas}
          hrefFor={(n) => hrefPaginaMarca(pagina.slug, n, estado.linea)}
          renderLink={linkNext}
        />
      ) : null}
    </SeccionMarca>
  );
}
