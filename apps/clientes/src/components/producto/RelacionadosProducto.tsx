import Link from "next/link";
import { ProductosCarrusel } from "@/components/ProductosCarrusel";
import { TarjetaProductoCarrusel } from "@/components/TarjetaProductoCarrusel";
import { relacionadosProducto } from "@/lib/catalogo-publico";
import { formatRubro } from "@/lib/formato-rubro";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";

const CANTIDAD = 8;

/**
 * "Productos similares" al pie de la ficha (misma categoría, ver
 * `relacionadosProducto`). Va en su propio Suspense: si tarda
 * o falla, la ficha ya se ve y esta sección simplemente no aparece.
 */
export async function RelacionadosProducto({
  categoriaPropiaId,
  categoria,
  productoId,
  soloVisibles,
  oferta,
}: {
  categoriaPropiaId?: string;
  categoria?: string;
  productoId: string;
  soloVisibles: boolean;
  oferta: OfertaCuotas | null;
}) {
  const relacionados = await relacionadosProducto({
    categoriaPropiaId,
    categoria,
    excluirId: productoId,
    cantidad: CANTIDAD,
    soloVisibles,
  });
  if (!relacionados || relacionados.productos.length === 0) return null;

  const rubro = formatRubro(relacionados.categoria);
  return (
    <section aria-labelledby="relacionados-titulo" className="mt-16">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 id="relacionados-titulo" className="font-display text-xl font-semibold text-text">
          Productos similares
        </h2>
        <Link
          href={`/catalogo?categoria=${encodeURIComponent(relacionados.categoria)}`}
          className="shrink-0 text-sm font-semibold text-accent transition-colors hover:text-primary"
        >
          Ver todo en {rubro}
        </Link>
      </div>
      <ProductosCarrusel label={`Productos similares de ${rubro}`}>
        {relacionados.productos.map((p) => (
          <TarjetaProductoCarrusel key={p.id} producto={p} oferta={oferta} />
        ))}
      </ProductosCarrusel>
    </section>
  );
}
