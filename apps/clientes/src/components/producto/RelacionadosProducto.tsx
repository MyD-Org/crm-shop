import Link from "next/link";
import { ProductosCarrusel } from "@/components/ProductosCarrusel";
import { TarjetaProductoCarrusel } from "@/components/TarjetaProductoCarrusel";
import { relacionadosProducto } from "@/lib/catalogo-publico";
import { formatRubro } from "@/lib/formato-rubro";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";

const CANTIDAD = 8;

/**
 * "Más de <categoría>" al pie de la ficha. Va en su propio Suspense: si tarda
 * o falla, la ficha ya se ve y esta sección simplemente no aparece.
 */
export async function RelacionadosProducto({
  categoria,
  productoId,
  soloVisibles,
  oferta,
}: {
  categoria: string;
  productoId: string;
  soloVisibles: boolean;
  oferta: OfertaCuotas | null;
}) {
  const productos = await relacionadosProducto({
    categoria,
    excluirId: productoId,
    cantidad: CANTIDAD,
    soloVisibles,
  });
  if (productos.length === 0) return null;

  const rubro = formatRubro(categoria);
  return (
    <section aria-labelledby="relacionados-titulo" className="mt-16">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 id="relacionados-titulo" className="font-display text-xl font-semibold text-text">
          Más de {rubro}
        </h2>
        <Link
          href={`/catalogo?categoria=${encodeURIComponent(categoria)}`}
          className="shrink-0 text-sm font-semibold text-accent transition-colors hover:text-primary"
        >
          Ver todo
        </Link>
      </div>
      <ProductosCarrusel label={`Más de ${rubro}`}>
        {productos.map((p) => (
          <TarjetaProductoCarrusel key={p.id} producto={p} oferta={oferta} />
        ))}
      </ProductosCarrusel>
    </section>
  );
}
