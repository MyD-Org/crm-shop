"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AccentText } from "@myd-org/ui";
import { clasesVisibilidad, type PromocionesContent } from "@/data/home-defaults";
import type { Product } from "@/data/products";
import { AddToCartButton } from "@/components/AddToCartButton";
import { BotonFavorito } from "@/components/BotonFavorito";
import { AhorroPesos, EtiquetaMasBarato, UnidadesPromo } from "@/components/promociones/piezas";
import { VideoMarca } from "@/components/marcas/VideoMarca";
import { CuentaRegresiva } from "@/components/promociones/CuentaRegresiva";
import { fmtPrecioCorto } from "@/lib/format";
import { nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";
import {
  ahorroPesos,
  fechaCortaAR,
  porcentajeAhorro,
  precioPrincipal,
  textoLegales,
  type EstadoPromo,
} from "@/lib/promociones/promo";
import { useModoEdicion } from "./ModoEdicion";

export const AVISO_AJUSTE_CRM = "Quite el ajuste de precio del producto en Precios online del CRM.";

type Props = {
  contenido: PromocionesContent;
  /** `quedan` null = sin contador de unidades. */
  estrella: { producto: Product; quedan: number | null } | null;
  items: Product[];
  estado: EstadoPromo;
  /** SKUs cargados que no se dibujan (oculto, borrado o sin stock): sólo se avisan en edición. */
  noResueltos?: string[];
  /** Fuerza el modo edición (tests); ausente = el de la barra de edición. */
  edicion?: boolean;
};

/*
 * Diseño (spec 2026-10-26-promociones-home §5, segunda versión): la sección es una banda navy de la
 * marca que se despega de la home crema, con una cinta de lanzamiento y la cuenta regresiva en
 * cajas como elemento protagonista. La oferta se lee SOBRE la foto: etiqueta "X % más barato que en
 * otras tiendas" y, en las ofertas, el ahorro en pesos. Las unidades van en casilleros (ver piezas.tsx).
 * El rojo de oferta es `danger` del DS; el celeste del acento es el del logo.
 */
const CELESTE = "text-[#58C8F9]";

/** El producto estrella: foto con la etiqueta de descuento a la izquierda, panel de precio a la derecha. */
function Estrella({ contenido, producto, quedan, edicion }: { contenido: PromocionesContent } & NonNullable<Props["estrella"]> & { edicion: boolean }) {
  const e = contenido.estrella!;
  const { monto, esTransferencia } = precioPrincipal(producto);
  const pct = porcentajeAhorro(monto, e.precioReferencia);
  const pesos = ahorroPesos(monto, e.precioReferencia);
  const agotada = quedan === 0 || producto.stock === "out";
  const conContador = !agotada && quedan !== null && quedan > 0 && !!e.unidadesPromo;
  const foto = producto.images?.[0]?.url;
  const href = `/producto/${producto.id}`;
  const titulo = e.titulo || producto.name;

  return (
    <article className="grid overflow-hidden rounded-2xl bg-white text-text shadow-2xl md:grid-cols-[1.2fr_1fr]">
      <div className="relative aspect-[4/3] bg-elevated md:aspect-auto md:min-h-[440px]">
        {e.video ? (
          <VideoMarca url={e.video} titulo={titulo} />
        ) : foto ? (
          <Image src={foto} alt={titulo} fill sizes="(max-width: 768px) 100vw, 55vw" className="object-contain p-10" />
        ) : null}
        {/* Etiquetas en las esquinas: no tapan el producto ni el botón de play, y no capturan clics. */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2 md:inset-x-5 md:top-5">
          <span className="rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-white shadow-md">{contenido.etiquetaBadge}</span>
          {pct && !agotada ? <EtiquetaMasBarato pct={pct} grande /> : null}
        </div>
        {agotada ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-text/85 px-4 py-2.5 text-center text-sm font-bold text-white">
            Agotado a precio de apertura
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-5 border-black/5 p-[clamp(20px,2.6vw,36px)] md:border-l">
        <div className="flex flex-col gap-2">
          <h3 className="font-display text-[clamp(20px,2.2vw,28px)] font-semibold leading-tight text-text">{titulo}</h3>
          {e.bajada ? <p className="max-w-prose text-sm text-muted">{e.bajada}</p> : null}
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-bold text-danger">Precio de apertura</p>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-[clamp(38px,5vw,60px)] font-extrabold leading-none tabular-nums text-primary">{fmtPrecioCorto(monto)}</span>
              {esTransferencia ? <span className="text-sm text-muted">por transferencia</span> : null}
            </p>
          </div>
          {pesos && e.precioReferencia ? <AhorroPesos pesos={pesos} referencia={e.precioReferencia} etiqueta={contenido.etiquetaReferencia} /> : null}
        </div>

        {conContador ? <UnidadesPromo quedan={quedan!} total={e.unidadesPromo!} /> : null}
        {agotada ? <p className="text-sm font-semibold text-text">Agotadas las unidades a precio de apertura</p> : null}
        {agotada && edicion ? <p className="rounded-md bg-warning/90 px-3 py-2 text-xs font-medium text-black">{AVISO_AJUSTE_CRM}</p> : null}

        <div className="mt-auto flex flex-wrap items-center gap-3">
          {agotada ? null : (
            <div className="min-w-[200px] flex-1">
              <AddToCartButton product={producto} />
            </div>
          )}
          <Link href={href} className="text-sm font-semibold text-primary underline underline-offset-4 hover:text-accent">
            Ver detalle
          </Link>
        </div>
      </div>
    </article>
  );
}

/**
 * Una oferta: card propia de la promo (todas de la misma altura, botón abajo). Sobre la foto, la
 * etiqueta de descuento y el ahorro en pesos; sin referencia, la foto queda limpia. El precio
 * principal es el de transferencia: es el de la promo.
 */
function Oferta({ contenido, producto }: { contenido: PromocionesContent; producto: Product }) {
  const ref = contenido.items.find((i) => i.sku.trim().toUpperCase() === (producto.sku ?? "").toUpperCase())?.precioReferencia;
  const { monto, esTransferencia } = precioPrincipal(producto);
  const pct = porcentajeAhorro(monto, ref);
  const pesos = ahorroPesos(monto, ref);
  const marca = producto.brand ? formatMarca(producto.brand) : undefined;
  const { nombre } = nombreConMarca(producto.name, marca);
  const foto = producto.images?.[0]?.url;
  const href = `/producto/${producto.id}`;

  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-white text-text shadow-lg">
      <Link href={href} className="relative block aspect-square bg-elevated" aria-label={nombre}>
        {foto ? <Image src={foto} alt={nombre} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-contain p-6" /> : null}
        <div data-sello-item={producto.sku} className="pointer-events-none absolute left-2.5 top-2.5 flex flex-col items-start gap-1.5">
          {/* En mobile no entra al lado del corazón de favoritos: la franja de ahorro ya dice que es promo. */}
          <span className="hidden rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-white shadow sm:inline">{contenido.etiquetaBadge}</span>
        </div>
        {pesos && ref ? (
          <div className="pointer-events-none absolute inset-x-2.5 bottom-2.5">
            <AhorroPesos pesos={pesos} referencia={ref} etiqueta={contenido.etiquetaReferencia} pct={pct} enFoto />
          </div>
        ) : null}
      </Link>
      <div className="absolute right-2.5 top-2.5">
        <BotonFavorito productId={producto.id} />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          {marca ? <p className="text-xs text-muted">{marca}</p> : null}
          <Link href={href} className="line-clamp-2 min-h-[2.6em] text-sm font-medium leading-snug hover:text-primary">
            {nombre}
          </Link>
        </div>
        <div className="mt-auto">
          <p className="text-[11px] font-bold text-danger">Precio de apertura</p>
          <p className="font-display text-[clamp(20px,2vw,26px)] font-extrabold leading-tight tabular-nums text-primary">{fmtPrecioCorto(monto)}</p>
          {esTransferencia ? <p className="text-xs text-muted">por transferencia</p> : null}
        </div>
        {producto.grupo ? (
          <Link href={href} className="rounded-lg bg-primary-soft py-2 text-center text-sm font-semibold text-primary">
            Ver opciones
          </Link>
        ) : (
          <AddToCartButton product={producto} />
        )}
      </div>
    </article>
  );
}

export function PromocionesVista({ contenido, estrella, items, estado, noResueltos = [], edicion: forzada }: Props) {
  const modo = useModoEdicion();
  const edicion = forzada ?? (modo.puedeEditar && modo.activo);
  const [terminada, setTerminada] = useState(false);

  const hayProductos = !!estrella || items.length > 0;
  const visible = estado === "vigente" && !terminada && hayProductos;
  if (!visible && !edicion) return null;

  const avisoVigencia =
    !hayProductos && noResueltos.length === 0
      ? "Cargue un producto estrella o hasta 6 ofertas y una fecha de fin para mostrar la promo."
      : estado === "programada" && contenido.inicio
        ? `Programada: empieza el ${fechaCortaAR(contenido.inicio)}.`
        : (estado === "terminada" || terminada) && contenido.fin
          ? `Terminó el ${fechaCortaAR(contenido.fin)}. Los visitantes ya no la ven.`
          : estado === "inactiva"
            ? "Falta la fecha de fin: los visitantes no ven la promo."
            : null;
  const avisos = [noResueltos.length > 0 ? `No se encontró o está oculto: ${noResueltos.join(", ")}` : null, avisoVigencia].filter(
    (a): a is string => !!a,
  );

  const unidadesLegales = contenido.estrella?.unidadesPromo;
  const { titulo, tituloMobile, bajada, visibilidadTextos } = contenido;
  return (
    <section className="flex flex-col gap-4 pt-[clamp(40px,5vw,72px)]" aria-label="Promociones">
      {edicion
        ? avisos.map((a) => (
            <p key={a} className="rounded-md bg-warning-soft px-4 py-3 text-sm text-text">
              {a}
            </p>
          ))
        : null}

      <div className="relative overflow-hidden rounded-3xl bg-primary px-[clamp(16px,3vw,40px)] pb-[clamp(20px,3vw,40px)] pt-[clamp(20px,2.6vw,32px)] text-white">
        {/* Halo celeste detrás del encabezado: marca la banda sin competir con la foto. */}
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-[#58C8F9]/15 blur-3xl" />

        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="flex max-w-2xl flex-col gap-3">
            {contenido.eyebrow ? (
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-danger px-3 py-1 text-xs font-bold text-white">
                <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                {contenido.eyebrow}
              </span>
            ) : null}
            {titulo || tituloMobile ? (
              <h2 className={`font-display text-[clamp(32px,4.4vw,56px)] font-extrabold leading-[1.02] tracking-[-0.02em] ${clasesVisibilidad(visibilidadTextos?.titulo)}`}>
                <AccentText text={titulo ?? ""} mobileText={tituloMobile} accentClassName={`not-italic ${CELESTE}`} />
              </h2>
            ) : null}
            {bajada ? <p className={`max-w-[52ch] text-[15px] leading-[1.6] text-white/75 ${clasesVisibilidad(visibilidadTextos?.bajada)}`}>{bajada}</p> : null}
          </div>
          {contenido.fin ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-white/80">
                La promo termina en <span className="text-white/60">· hasta el {fechaCortaAR(contenido.fin)}</span>
              </p>
              <CuentaRegresiva fin={contenido.fin} onFin={() => setTerminada(true)} variante="cajas" />
            </div>
          ) : null}
        </div>

        <div className="relative mt-[clamp(20px,3vw,32px)] flex flex-col gap-4">
          {estrella ? <Estrella contenido={contenido} {...estrella} edicion={edicion} /> : null}
          {items.length > 0 ? (
            <div className="grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {items.map((p) => (
                <Oferta key={p.id} contenido={contenido} producto={p} />
              ))}
            </div>
          ) : null}
        </div>

        <div className="relative mt-5 flex flex-wrap items-center justify-between gap-3">
          {contenido.legales && contenido.fin ? (
            <p className="max-w-3xl text-[11px] leading-relaxed text-white/60">
              {textoLegales(contenido.legales, { inicio: contenido.inicio, fin: contenido.fin, unidades: unidadesLegales })}
            </p>
          ) : null}
          {contenido.linkTodos ? (
            <Link href={contenido.linkTodos} className="text-sm font-bold text-white underline underline-offset-4 hover:text-white/80">
              Ver todas las ofertas
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
