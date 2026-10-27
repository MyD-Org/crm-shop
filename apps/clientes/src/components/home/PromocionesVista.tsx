"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Badge, cn } from "@myd-org/ui";
import type { PromocionesContent } from "@/data/home-defaults";
import type { Product } from "@/data/products";
import { AddToCartButton } from "@/components/AddToCartButton";
import { TarjetaProductoCarrusel } from "@/components/TarjetaProductoCarrusel";
import { VideoMarca } from "@/components/marcas/VideoMarca";
import { CuentaRegresiva } from "@/components/promociones/CuentaRegresiva";
import { fmtPrecioCorto } from "@/lib/format";
import {
  esUltimas,
  fechaCortaAR,
  porcentajeAhorro,
  precioPrincipal,
  textoLegales,
  type EstadoPromo,
} from "@/lib/promociones/promo";
import { useModoEdicion } from "./ModoEdicion";
import { TituloSeccion } from "./TituloSeccion";

export const AVISO_AJUSTE_CRM = "Quite el ajuste de precio del producto en Precios online del CRM.";

type Props = {
  contenido: PromocionesContent;
  /** `quedan` null = sin contador de unidades. */
  estrella: { producto: Product; quedan: number | null } | null;
  items: Product[];
  estado: EstadoPromo;
  /** Fuerza el modo edición (tests); ausente = el de la barra de edición. */
  edicion?: boolean;
};

/** Línea "En otras tiendas desde $X" + chip de ahorro; nada si la referencia no ahorra. */
function Referencia({ etiqueta, precio, referencia, oscuro }: { etiqueta: string; precio: number; referencia?: number; oscuro?: boolean }) {
  const pct = porcentajeAhorro(precio, referencia);
  if (!pct || !referencia) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-2 text-sm", oscuro ? "text-white/75" : "text-muted")}>
      <span>
        {etiqueta} {fmtPrecioCorto(referencia)}
      </span>
      <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">−{pct} %</span>
    </p>
  );
}

function Unidades({ quedan, total }: { quedan: number; total: number }) {
  const ultimas = esUltimas(quedan);
  return (
    <div className="flex flex-col gap-1.5">
      <p className={cn("text-sm", ultimas ? "font-semibold text-[#ff8a8a]" : "text-white/85")}>
        {ultimas ? "¡Últimas unidades! " : ""}
        Quedan <strong>{quedan} de {total}</strong> a precio de apertura
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden>
        <div className="h-full rounded-full bg-danger" style={{ width: `${(quedan / total) * 100}%` }} />
      </div>
    </div>
  );
}

/** El producto estrella como etiqueta de precio: media a la izquierda, panel de la marca con el precio. */
function Estrella({ contenido, producto, quedan, edicion }: { contenido: PromocionesContent } & NonNullable<Props["estrella"]> & { edicion: boolean }) {
  const e = contenido.estrella!;
  const { monto, esTransferencia } = precioPrincipal(producto);
  const agotada = quedan === 0 || producto.stock === "out";
  const foto = producto.images?.[0]?.url;
  const href = `/producto/${producto.id}`;
  const titulo = e.titulo || producto.name;

  return (
    <article className="grid overflow-hidden rounded-2xl border border-black/5 bg-surface md:grid-cols-[1.15fr_1fr]">
      <div className="relative aspect-[4/3] bg-elevated md:aspect-auto md:min-h-[380px]">
        {e.video ? (
          <VideoMarca url={e.video} titulo={titulo} />
        ) : foto ? (
          <Image src={foto} alt={titulo} fill sizes="(max-width: 768px) 100vw, 55vw" className="object-contain p-6" />
        ) : null}
      </div>
      <div className="flex flex-col justify-between gap-6 bg-primary p-[clamp(20px,2.6vw,36px)] text-white">
        <div className="flex flex-col items-start gap-3">
          <Badge tone="danger">{contenido.etiquetaBadge}</Badge>
          <h3 className="font-display text-[clamp(20px,2.2vw,28px)] font-semibold leading-tight">{titulo}</h3>
          {e.bajada ? <p className="max-w-prose text-sm text-white/75">{e.bajada}</p> : null}
        </div>

        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-[clamp(36px,4.6vw,56px)] font-bold leading-none tabular-nums">{fmtPrecioCorto(monto)}</span>
            {esTransferencia ? <span className="text-sm text-white/75">por transferencia</span> : null}
          </p>
          <Referencia etiqueta={contenido.etiquetaReferencia} precio={monto} referencia={e.precioReferencia} oscuro />
          {!agotada && quedan !== null && quedan > 0 && e.unidadesPromo ? <Unidades quedan={quedan} total={e.unidadesPromo} /> : null}
          {agotada ? <p className="text-sm font-semibold text-white">Agotadas las unidades a precio de apertura</p> : null}
          {agotada && edicion ? <p className="rounded-md bg-warning/90 px-3 py-2 text-xs font-medium text-black">{AVISO_AJUSTE_CRM}</p> : null}
          {contenido.fin ? <CuentaRegresiva fin={contenido.fin} className="text-sm text-white/85" /> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {agotada ? null : (
            <div className="min-w-[180px] flex-1">
              <AddToCartButton product={producto} />
            </div>
          )}
          <Link href={href} className="text-sm font-semibold underline underline-offset-4 hover:text-white/80">
            Ver detalle
          </Link>
        </div>
      </div>
    </article>
  );
}

export function PromocionesVista({ contenido, estrella, items, estado, edicion: forzada }: Props) {
  const modo = useModoEdicion();
  const edicion = forzada ?? (modo.puedeEditar && modo.activo);
  const [terminada, setTerminada] = useState(false);

  const hayProductos = !!estrella || items.length > 0;
  const visible = estado === "vigente" && !terminada && hayProductos;
  if (!visible && !edicion) return null;

  const aviso =
    !hayProductos
      ? "Cargue un producto estrella o hasta 6 ofertas y una fecha de fin para mostrar la promo."
      : estado === "programada" && contenido.inicio
        ? `Programada: empieza el ${fechaCortaAR(contenido.inicio)}.`
        : (estado === "terminada" || terminada) && contenido.fin
          ? `Terminó el ${fechaCortaAR(contenido.fin)}. Los visitantes ya no la ven.`
          : estado === "inactiva"
            ? "Falta la fecha de fin: los visitantes no ven la promo."
            : null;

  const unidadesLegales = contenido.estrella?.unidadesPromo;
  return (
    <section className="flex flex-col gap-6 pt-[clamp(40px,5vw,72px)]" aria-label="Promociones">
      {edicion && aviso ? <p className="rounded-md bg-warning-soft px-4 py-3 text-sm text-text">{aviso}</p> : null}
      <div>
        {contenido.eyebrow ? <p className="mb-2 text-sm font-semibold text-danger">{contenido.eyebrow}</p> : null}
        <TituloSeccion textos={contenido} linkTodos={contenido.linkTodos} />
      </div>
      {estrella ? <Estrella contenido={contenido} {...estrella} edicion={edicion} /> : null}
      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {items.map((p) => {
            const ref = contenido.items.find((i) => i.sku.trim().toUpperCase() === (p.sku ?? "").toUpperCase())?.precioReferencia;
            return (
              <div key={p.id} className="flex flex-col gap-2">
                <TarjetaProductoCarrusel producto={{ ...p, badgeText: contenido.etiquetaBadge, badgeTone: "danger" }} />
                <Referencia etiqueta={contenido.etiquetaReferencia} precio={precioPrincipal(p).monto} referencia={ref} />
              </div>
            );
          })}
        </div>
      ) : null}
      {contenido.legales && contenido.fin ? (
        <p className="text-xs text-muted">
          {textoLegales(contenido.legales, { inicio: contenido.inicio, fin: contenido.fin, unidades: unidadesLegales })}
        </p>
      ) : null}
      {/* Al llegar a cero la promo se oculta sin recargar (la cuenta de la estrella sólo se ve con estrella). */}
      {contenido.fin && !estrella ? <CuentaRegresiva fin={contenido.fin} onFin={() => setTerminada(true)} className="text-sm text-muted" /> : null}
      {contenido.fin && estrella ? <OcultarAlTerminar fin={contenido.fin} onFin={() => setTerminada(true)} /> : null}
    </section>
  );
}

/** Sólo escucha el fin (la cuenta visible está en la estrella). */
function OcultarAlTerminar({ fin, onFin }: { fin: string; onFin: () => void }) {
  return <CuentaRegresiva fin={fin} onFin={onFin} className="sr-only" />;
}
