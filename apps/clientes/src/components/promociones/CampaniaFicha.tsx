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

/**
 * Precio habitual que se tacha y ahorro en pesos del recuadro, los dos con IVA y de la MISMA lista.
 * Con medio destacado (transferencia) es la suya: el precio grande de la ficha y el carrito (que
 * cotiza con transferencia) usan esa lista, así el «Ahorre $ X» de la ficha es el «Usted ahorra» del
 * carrito para 1 unidad. Sin medio, la lista general (`oldPrice` contra `precioFinal`).
 */
export function habitualYAhorro(
  producto: Pick<Product, "oldPrice" | "precioFinal" | "precioMedio" | "preciosMedios" | "campania">,
): { habitual: number; ahorro: number | null; medio?: string } | null {
  // Ficha: el medio más barato de sus líneas (el que se destaca) contra su propio habitual.
  const deFicha = (producto.preciosMedios ?? [])
    .flatMap((m) => {
      const habitual = producto.campania?.habitualesMedios?.find((h) => h.slug === m.slug && h.forma === m.forma)?.precioFinal;
      return m.precioFinal != null && habitual != null && habitual > m.precioFinal ? [{ m, habitual, final: m.precioFinal }] : [];
    })
    .sort((a, b) => a.final - b.final)[0];
  if (deFicha) return { habitual: deFicha.habitual, ahorro: redondear(deFicha.habitual - deFicha.final), medio: deFicha.m.nombre };
  const habitualMedio = producto.campania?.habitualMedio;
  const campaniaMedio = producto.precioMedio?.precioFinal;
  if (habitualMedio != null && campaniaMedio != null && habitualMedio > campaniaMedio) {
    return { habitual: habitualMedio, ahorro: redondear(habitualMedio - campaniaMedio), medio: producto.precioMedio!.nombre };
  }
  if (!producto.oldPrice) return null;
  const ahorro =
    producto.precioFinal != null && producto.oldPrice > producto.precioFinal ? redondear(producto.oldPrice - producto.precioFinal) : null;
  return { habitual: producto.oldPrice, ahorro };
}

const redondear = (n: number) => Math.round(n * 100) / 100;

export function CampaniaFicha({ producto }: { producto: Product }) {
  const router = useRouter();
  const ahora = useAhora();
  const c = producto.campania;
  if (!c) return null;
  // Sin stock en la tienda manda el stock: nunca "quedan N" sobre algo que no se puede comprar.
  const quedan = producto.stock === "out" ? 0 : c.quedan;
  const conFin = !c.hastaAgotarStock && mostrarFin(c.fin, ahora);
  const precios = habitualYAhorro(producto);
  const ahorro = precios?.ahorro ?? null;
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
        {precios ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">
              Precio habitual <span className="tabular-nums line-through">{fmtPrecioCorto(precios.habitual)}</span>
              {precios.medio ? <> con {precios.medio}</> : null}
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
