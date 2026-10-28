"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AccentText } from "@myd-org/ui";
import { clasesVisibilidad, type PromocionesContent } from "@/data/home-defaults";
import type { Product } from "@/data/products";
import { AddToCartButton } from "@/components/AddToCartButton";
import { BotonFavorito } from "@/components/BotonFavorito";
import { EscaleraPrecios, PrecioPromo, UnidadesPromo } from "@/components/promociones/piezas";
import { useMarca } from "@/components/MarcaProvider";
import { VideoMarca } from "@/components/marcas/VideoMarca";
import { CuentaRegresiva } from "@/components/promociones/CuentaRegresiva";
import { nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";
import {
  fechaCortaAR,
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

/** Precio habitual y referencias de un SKU de la promo (estrella o item), por SKU normalizado. */
function datosDe(contenido: PromocionesContent, sku: string | undefined) {
  const k = (sku ?? "").trim().toUpperCase();
  return [contenido.estrella, ...contenido.items].find((i) => i && i.sku.trim().toUpperCase() === k);
}

/** El producto estrella: foto limpia a la izquierda, panel de precio y comparación a la derecha. */
function Estrella({ contenido, producto, quedan, edicion }: { contenido: PromocionesContent } & NonNullable<Props["estrella"]> & { edicion: boolean }) {
  const e = contenido.estrella!;
  const { nombre: tienda } = useMarca();
  const { monto, esTransferencia } = precioPrincipal(producto);
  const agotada = quedan === 0 || producto.stock === "out";
  const conContador = !agotada && quedan !== null && quedan > 0 && !!e.unidadesPromo;
  const foto = producto.images?.[0]?.url;
  const href = `/producto/${producto.id}`;
  const titulo = e.titulo || producto.name;

  return (
    <article className="grid overflow-hidden rounded-2xl bg-white text-text shadow-2xl md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div className="relative aspect-[4/3] bg-elevated md:aspect-auto md:min-h-[320px]">
        {e.video ? (
          <VideoMarca url={e.video} titulo={titulo} />
        ) : foto ? (
          // Con tope de tamaño: la foto del catálogo viene en 800 px y estirada se pixela.
          <div className="absolute inset-6 m-auto max-h-[340px] max-w-[400px]">
            <Image src={foto} alt={titulo} fill sizes="(max-width: 768px) 90vw, 400px" className="object-contain" />
          </div>
        ) : null}
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-white shadow-md md:left-5 md:top-5">
          {contenido.etiquetaBadge}
        </span>
        {agotada ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-text/85 px-4 py-2.5 text-center text-sm font-bold text-white">
            Agotado a precio de apertura
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 border-black/5 p-[clamp(18px,2.2vw,28px)] md:border-l">
        <div className="flex flex-col gap-1.5">
          <h3 className="font-display text-[clamp(18px,1.8vw,24px)] font-semibold leading-tight text-text">{titulo}</h3>
          {e.bajada ? <p className="max-w-prose text-sm text-muted">{e.bajada}</p> : null}
        </div>

        {/* En pantallas muy anchas (xl), dos columnas (precio y unidades | comparación): la card no crece en alto. */}
        <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
          <div className="flex flex-col gap-4">
            <PrecioPromo precio={monto} habitual={e.precioHabitual} esTransferencia={esTransferencia} />
            {conContador ? <UnidadesPromo quedan={quedan!} total={e.unidadesPromo!} /> : null}
          </div>
          <EscaleraPrecios
            precio={monto}
            referencias={e.referencias}
            tienda={tienda}
            titulo={contenido.tituloComparador}
            fecha={contenido.fechaRelevamiento}
          />
        </div>

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
 * Una oferta. Escritorio: card vertical de altura pareja (foto, nombre, antes/ahora, escalera
 * compacta, botón). Mobile: fila horizontal con la foto chica a la izquierda, sin nada encima de
 * la foto ni escalera (no entran sin tapar el producto). El precio principal es el de transferencia.
 */
function Oferta({ contenido, producto }: { contenido: PromocionesContent; producto: Product }) {
  const datos = datosDe(contenido, producto.sku);
  const { nombre: tienda } = useMarca();
  const { monto, esTransferencia } = precioPrincipal(producto);
  const marca = producto.brand ? formatMarca(producto.brand) : undefined;
  const { nombre } = nombreConMarca(producto.name, marca);
  const foto = producto.images?.[0]?.url;
  const href = `/producto/${producto.id}`;

  return (
    <article className="relative flex h-full flex-row gap-3 overflow-hidden rounded-2xl bg-white p-2.5 text-text shadow-lg sm:flex-col sm:gap-0 sm:p-0">
      <Link href={href} className="relative block aspect-square w-28 shrink-0 self-start overflow-hidden rounded-xl bg-elevated sm:w-full sm:self-auto sm:rounded-none" aria-label={nombre}>
        {foto ? <Image src={foto} alt={nombre} fill sizes="(max-width: 640px) 112px, 25vw" className="object-contain p-3 sm:p-6" /> : null}
        <span
          data-sello-item={producto.sku}
          className="pointer-events-none absolute left-2.5 top-2.5 hidden rounded-full bg-primary px-2.5 py-1 text-[11px] font-bold text-white shadow sm:inline"
        >
          {contenido.etiquetaBadge}
        </span>
      </Link>
      <div className="absolute right-2 top-2 sm:right-2.5 sm:top-2.5">
        <BotonFavorito productId={producto.id} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pr-9 sm:gap-3 sm:p-4">
        <div className="flex flex-col gap-0.5">
          {marca ? <p className="text-xs text-muted">{marca}</p> : null}
          <Link href={href} className="line-clamp-2 text-sm font-medium leading-snug hover:text-primary sm:min-h-[2.6em]">
            {nombre}
          </Link>
        </div>
        <PrecioPromo precio={monto} habitual={datos?.precioHabitual} esTransferencia={esTransferencia} tamano="chico" />
        <EscaleraPrecios precio={monto} referencias={datos?.referencias} tienda={tienda} compacta className="hidden sm:flex" />
        <div className="mt-auto">
          {producto.grupo ? (
            <Link href={href} className="block rounded-lg bg-primary-soft py-2 text-center text-sm font-semibold text-primary">
              Ver opciones
            </Link>
          ) : (
            <AddToCartButton product={producto} />
          )}
        </div>
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

        {/* Línea de arriba: la cinta de lanzamiento y la cuenta regresiva; debajo, el título a todo el ancho. */}
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          {contenido.eyebrow ? (
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-danger px-3 py-1 text-xs font-bold text-white">
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              {contenido.eyebrow}
            </span>
          ) : (
            <span />
          )}
          {contenido.fin ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold text-white/80">
                La promo termina en <span className="text-white/60">· hasta el {fechaCortaAR(contenido.fin)}</span>
              </p>
              <CuentaRegresiva fin={contenido.fin} onFin={() => setTerminada(true)} variante="cajas" />
            </div>
          ) : null}
        </div>
        <div className="relative mt-4 flex flex-col gap-2">
          {titulo || tituloMobile ? (
            <h2 className={`font-display text-[clamp(32px,5vw,64px)] font-extrabold leading-[1.02] tracking-[-0.02em] ${clasesVisibilidad(visibilidadTextos?.titulo)}`}>
              <AccentText text={titulo ?? ""} mobileText={tituloMobile} accentClassName={`not-italic ${CELESTE}`} />
            </h2>
          ) : null}
          {bajada ? <p className={`max-w-[60ch] text-[15px] leading-[1.6] text-white/75 ${clasesVisibilidad(visibilidadTextos?.bajada)}`}>{bajada}</p> : null}
        </div>

        <div className="relative mt-[clamp(20px,3vw,32px)] flex flex-col gap-4">
          {estrella ? <Estrella contenido={contenido} {...estrella} edicion={edicion} /> : null}
          {items.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:auto-rows-fr sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
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
