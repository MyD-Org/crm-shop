"use client";

import { useRouter } from "next/navigation";
import type { Product } from "@/data/products";
import { fmtPrecioCorto } from "@/lib/format";
import { esUltimas, fechaCortaAR, frasePrecio } from "@/lib/promociones/promo";
import { CuentaRegresiva } from "./CuentaRegresiva";
import { UnidadesPromo } from "./piezas";
import { useAhora } from "./reloj";

/** Días antes del fin desde los que la ficha muestra la fecha y la cuenta regresiva. */
export const DIAS_AVISO_FIN = 7;

/**
 * ¿Se muestra el fin de la campaña? Sólo cuando falta poco: una campaña larga (o "sin fecha", cargada
 * con un fin lejano) no anuncia cuándo termina. Sin reloj (servidor e hidratación) no se muestra.
 */
export function mostrarFin(fin: string, ahora: number | null): boolean {
  if (ahora === null) return false;
  return Date.parse(fin) - ahora <= DIAS_AVISO_FIN * 24 * 60 * 60 * 1000;
}

/**
 * Bloque de una campaña de precios en la ficha (spec apps/admin/docs/superpowers/specs/
 * 2026-10-28-campanias-precios-design.md; diseño «A · color de la marca», 2026-11-26): recuadro con
 * el acento de cada piel, franja con la etiqueta y "Termina el …" (sólo en los últimos días, ver
 * `mostrarFin`), nuestro precio habitual tachado, el % (en `highlight`, el color "luz" de la piel) y
 * el ahorro en pesos en verde, las unidades que quedan (si la regla tiene límite) y la cuenta regresiva. El precio grande ya es el de campaña (`producto.price`).
 * Al terminar la campaña la página se refresca: el precio vuelve al normal sin recargar a mano.
 */
/**
 * Pestaña «OFERTA −N %» pegada a la esquina de la foto de la ficha (diseño A): en el resaltado de
 * la piel (ámbar en Luz Atlántica, amarillo en Central Led), como el «N % menos» del recuadro.
 */
export function PestaniaOferta({ pct }: { pct: number }) {
  return (
    <span
      data-pestania-oferta=""
      className="inline-block rounded-br-2xl bg-highlight px-4 py-2 font-display text-xs font-extrabold uppercase tracking-wider text-text"
    >
      Oferta −{pct} %
    </span>
  );
}

export function CampaniaFicha({ producto }: { producto: Product }) {
  const router = useRouter();
  const ahora = useAhora();
  const c = producto.campania;
  if (!c) return null;
  // Sin stock en la tienda manda el stock: nunca "quedan N" sobre algo que no se puede comprar.
  const quedan = producto.stock === "out" ? 0 : c.quedan;
  const conFin = !c.hastaAgotarStock && mostrarFin(c.fin, ahora);
  // Ahorro en pesos contra el precio habitual de la misma lista: los dos con IVA.
  const ahorro =
    producto.oldPrice && producto.precioFinal != null && producto.oldPrice > producto.precioFinal
      ? producto.oldPrice - producto.precioFinal
      : null;
  return (
    <div data-campania={c.id} className="mt-4 overflow-hidden rounded-2xl border-2 border-accent bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-accent-soft px-4 py-2.5">
        <span className="font-display text-sm font-extrabold uppercase tracking-wider text-accent">{c.etiqueta}</span>
        {c.hastaAgotarStock ? (
          <span className="text-sm font-semibold text-accent">Hasta agotar stock</span>
        ) : conFin ? (
          <span className="text-sm font-semibold text-accent">Termina el {fechaCortaAR(c.fin)}</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 p-4">
        {producto.oldPrice ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">
              Precio habitual <span className="tabular-nums line-through">{fmtPrecioCorto(producto.oldPrice)}</span>
            </p>
            <p className="flex flex-wrap items-center gap-2">
              <span data-descuento="" className="rounded-full bg-highlight px-3 py-1 text-sm font-extrabold text-text">
                {c.pct} % menos
              </span>
              {ahorro ? (
                <span data-ahorro="" className="rounded-full bg-success-soft px-3 py-1 text-sm font-extrabold text-success">
                  Ahorre {fmtPrecioCorto(ahorro)}
                </span>
              ) : null}
            </p>
          </div>
        ) : null}
      {c.unidades != null && quedan != null ? (
        quedan > 0 ? (
          // La urgencia (rojo, "¡Últimas…!") sólo cuando quedan pocas; si no, el dato neutro.
          esUltimas(quedan) ? (
            <UnidadesPromo quedan={quedan} total={c.unidades} etiqueta={frasePrecio(c.etiqueta, true)} />
          ) : (
            <p className="text-sm text-text">
              Quedan <span className="font-semibold tabular-nums">{quedan}</span> de {c.unidades} a {frasePrecio(c.etiqueta)}
            </p>
          )
        ) : (
          <p className="text-sm font-semibold text-text">Agotadas las unidades a {frasePrecio(c.etiqueta)}</p>
        )
      ) : null}
        {conFin ? <CuentaRegresiva fin={c.fin} className="text-sm text-text" onFin={() => router.refresh()} /> : null}
      </div>
    </div>
  );
}
