"use client";

import { useRouter } from "next/navigation";
import type { Product } from "@/data/products";
import { fmtPrecioCorto } from "@/lib/format";
import { enFrase, fechaCortaAR } from "@/lib/promociones/promo";
import { CuentaRegresiva } from "./CuentaRegresiva";
import { UnidadesPromo } from "./piezas";

/**
 * Bloque de una campaña de precios en la ficha (spec apps/admin/docs/superpowers/specs/
 * 2026-10-28-campanias-precios-design.md), con el diseño del de la promo de la home: la etiqueta,
 * "Termina el …", nuestro precio habitual tachado con el % en verde, las unidades que quedan (si la
 * regla tiene límite) y la cuenta regresiva. El precio grande ya es el de campaña (`producto.price`).
 * Al terminar la campaña la página se refresca: el precio vuelve al normal sin recargar a mano.
 */
export function CampaniaFicha({ producto }: { producto: Product }) {
  const router = useRouter();
  const c = producto.campania;
  if (!c) return null;
  // Sin stock en la tienda manda el stock: nunca "quedan N" sobre algo que no se puede comprar.
  const quedan = producto.stock === "out" ? 0 : c.quedan;
  return (
    <div data-campania={c.id} className="mt-4 flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">{c.etiqueta}</span>
        <span className="text-sm text-text">Termina el {fechaCortaAR(c.fin)}</span>
      </div>
      {producto.oldPrice ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>
            Precio habitual <span className="tabular-nums line-through">{fmtPrecioCorto(producto.oldPrice)}</span>
          </span>
          <span data-descuento="" className="rounded-md bg-success-soft px-2 py-0.5 text-xs font-bold text-success">
            {c.pct} % de descuento
          </span>
        </p>
      ) : null}
      {c.unidades != null && quedan != null ? (
        quedan > 0 ? (
          <UnidadesPromo quedan={quedan} total={c.unidades} etiqueta={c.etiqueta} />
        ) : (
          <p className="text-sm font-semibold text-text">Agotadas las unidades a {enFrase(c.etiqueta)}</p>
        )
      ) : null}
      <CuentaRegresiva fin={c.fin} className="text-sm text-text" onFin={() => router.refresh()} />
    </div>
  );
}
