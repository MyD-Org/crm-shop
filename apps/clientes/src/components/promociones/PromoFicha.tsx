"use client";

import type { PrecioMedio, Product } from "@/data/products";
import { useMarca } from "@/components/MarcaProvider";
import { fmtPrecioCorto } from "@/lib/format";
import { descuentoPropio, fechaCortaAR, precioPrincipal, textoLegales } from "@/lib/promociones/promo";
import { EscaleraPrecios, UnidadesPromo } from "./piezas";
import { CuentaRegresiva } from "./CuentaRegresiva";
import { usePromoProducto } from "./PromoProvider";

/**
 * Precio del medio destacado entre los de la ficha (el producto de la ficha no trae `precioMedio`):
 * la línea sin forma o, con listas por forma, la más barata, como la card. Sin él, undefined.
 */
function precioDestacadoEnFicha(medios: PrecioMedio[] | undefined, slug: string | undefined): PrecioMedio | undefined {
  const delMedio = (medios ?? []).filter((m) => m.slug === slug);
  const precio = (m: PrecioMedio) => m.precioFinal ?? m.price;
  return delMedio.find((m) => !m.forma) ?? delMedio.reduce<PrecioMedio | undefined>((min, m) => (!min || precio(m) < precio(min) ? m : min), undefined);
}

/**
 * Bloque de promo en la ficha (spec 2026-10-26-promociones-home §6): es lo que ve quien llega desde
 * un anuncio. Sin promo vigente para este SKU no dibuja nada.
 */
export function PromoFicha({
  producto,
  quedan,
  slugDestacado,
}: {
  producto: Product;
  quedan?: number | null;
  /** Medio destacado de las cards (`mediosPrecio.destacado.slug`): el ahorro coincide con la home. */
  slugDestacado?: string;
}) {
  const info = usePromoProducto(producto.sku);
  const { nombre: tienda } = useMarca();
  if (!info) return null;
  const precioMedio = producto.precioMedio ?? precioDestacadoEnFicha(producto.preciosMedios, slugDestacado);
  const { monto } = precioPrincipal({ ...producto, precioMedio });
  const descuento = descuentoPropio(monto, info.habitual);
  const conContador = info.esEstrella && info.unidadesPromo && quedan != null;
  // Sin stock en la tienda manda el stock: nunca "quedan N" sobre algo que no se puede comprar.
  const quedanVista = producto.stock === "out" ? 0 : quedan;

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">{info.etiquetaBadge}</span>
        <span className="text-sm text-text">Termina el {fechaCortaAR(info.fin)}</span>
      </div>
      {descuento && info.habitual ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>
            Precio habitual <span className="tabular-nums line-through">{fmtPrecioCorto(info.habitual)}</span>
          </span>
          <span data-descuento="" className="rounded-md bg-success-soft px-2 py-0.5 text-xs font-bold text-success">
            {descuento.pct} % de descuento
          </span>
        </p>
      ) : null}
      <EscaleraPrecios precio={monto} referencias={info.referencias} tienda={tienda} titulo={info.tituloComparador} />
      {conContador ? (
        quedanVista! > 0 ? (
          <UnidadesPromo quedan={quedanVista!} total={info.unidadesPromo!} />
        ) : (
          <p className="text-sm font-semibold text-text">Agotadas las unidades a precio de apertura</p>
        )
      ) : null}
      <CuentaRegresiva fin={info.fin} className="text-sm text-text" />
      {info.legales ? (
        <p className="text-xs text-muted">{textoLegales(info.legales, { inicio: info.inicio, fin: info.fin, unidades: info.unidadesPromo })}</p>
      ) : null}
    </div>
  );
}
