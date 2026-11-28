import type { Product } from "@/data/products";

/**
 * Descuento por cantidad en la ficha (campaña con mínimo de unidades, 0109 del CRM): el precio grande
 * es el de 1 unidad; este recuadro avisa que llevando el mínimo el carrito descuenta el % en todas las
 * unidades. Sale del mismo resolver que cobra el carrito (`porCantidadParaExhibir`).
 */
export function PorCantidadFicha({ producto }: { producto: Pick<Product, "porCantidad" | "stock"> }) {
  const p = producto.porCantidad;
  if (!p || producto.stock === "out") return null;
  return (
    <div data-por-cantidad="" className="mt-4 overflow-hidden rounded-2xl border-2 border-accent bg-surface">
      <div className="bg-accent-soft px-4 py-2.5">
        <span className="font-display text-sm font-extrabold uppercase tracking-wider text-accent">{p.etiqueta}</span>
      </div>
      <div className="flex flex-col gap-1 p-4">
        <p className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-highlight px-3 py-1 text-sm font-extrabold text-text">{p.pct} % menos</span>
          <span className="text-sm font-semibold text-text">llevando {p.minimo} unidades o más</span>
        </p>
        <p className="text-sm text-muted">El descuento se aplica en el carrito a todas las unidades.</p>
      </div>
    </div>
  );
}
