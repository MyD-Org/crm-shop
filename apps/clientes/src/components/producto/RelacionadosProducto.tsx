import Link from "next/link";
import { ProductosCarrusel } from "@/components/ProductosCarrusel";
import { TarjetaProductoCarrusel } from "@/components/TarjetaProductoCarrusel";
import { relacionadosProducto } from "@/lib/catalogo-publico";
import { formatRubro } from "@/lib/formato-rubro";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";
import type { ContextoDisponibilidad } from "@/lib/disponibilidad-contexto";
import type { MedioPrecio } from "@/lib/medios-precio";

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
  disp,
  destacado,
  oferta,
}: {
  categoriaPropiaId?: string;
  categoria?: string;
  productoId: string;
  soloVisibles: boolean;
  /** Flag `disponibilidad-sucursal`: contexto de la zona del visitante (undefined = apagado). */
  disp?: ContextoDisponibilidad;
  /** Medio destacado de las cards ("$X con <Medio>"). */
  destacado?: MedioPrecio | null;
  oferta: OfertaCuotas | null;
}) {
  const relacionados = await relacionadosProducto({
    categoriaPropiaId,
    categoria,
    excluirId: productoId,
    cantidad: CANTIDAD,
    soloVisibles,
    disp,
    destacado,
  });
  if (!relacionados || relacionados.productos.length === 0) return null;

  const rubro = formatRubro(relacionados.categoria);
  return (
    <section aria-labelledby="relacionados-titulo" className="mt-16">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 id="relacionados-titulo" className="shrink-0 font-display text-xl font-semibold text-text">
          Productos similares
        </h2>
        {/* En mobile solo "Ver todo": con el nombre del rubro el link no
            entraba y ensanchaba la página. Desde sm se recorta con "…". */}
        <Link
          href={`/catalogo?categoria=${encodeURIComponent(relacionados.categoria)}`}
          aria-label={`Ver todo en ${rubro}`}
          title={`Ver todo en ${rubro}`}
          className="min-w-0 truncate text-sm font-semibold text-accent transition-colors hover:text-primary"
        >
          Ver todo<span className="max-sm:hidden"> en {rubro}</span>
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
