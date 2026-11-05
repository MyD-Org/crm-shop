"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { partesNombre } from "@/lib/marca-base";
import { useMarca } from "./MarcaProvider";
import { VideoFacade } from "./producto/VideoFacade";
import { claveItem, debeMontarIframe, etiquetaVisor, reproduccionInicial, type ItemGaleria } from "./galeria-items";

/**
 * Visor de fotos y videos a pantalla completa de la ficha (como el de Mercado Libre):
 * se abre al tocar la foto grande, arranca en la foto que se estaba viendo y
 * al cerrar devuelve cuál quedó activa para que la galería de la ficha quede
 * en la misma.
 *
 * Misma mecánica que la galería: pista horizontal con scroll-snap, así en el
 * celular se pasa de foto con el dedo y la inercia nativa. Flechas desde md;
 * con teclado, ← → para moverse y Esc para cerrar.
 *
 * En el celular ocupa toda la pantalla; desde md es un modal grande sobre la
 * página oscurecida, y un clic afuera lo cierra. Arriba a la izquierda va la
 * marca (como el header: "Led" derecho y en el acento, ver .site-header em), sólo acá: en la galería y el catálogo
 * esa esquina y la otra ya tienen botones.
 *
 * Los videos (YouTube) van después de las fotos y cuentan igual en el contador, las flechas y el
 * teclado. Un video es poster + play: el iframe se monta sólo en el slide activo y sólo tras tocar
 * play (o al abrir con `reproducirInicial` desde el carrusel), y se desmonta en cuanto cambia el
 * slide activo o se cierra el visor. El iframe queda centrado en 16:9 dentro de un slide con
 * márgenes (que sí desplazan la pista) y, con un video activo, Anterior/Siguiente se ven en
 * cualquier ancho, fuera del iframe, junto al contador.
 *
 * Va por portal al `<body>`: dentro de la ficha, cualquier ancestro con
 * transform u overflow lo recortaría.
 */
export function VisorFotos({
  items,
  nombre,
  inicial,
  reproducirInicial = false,
  onCerrar,
}: {
  items: ItemGaleria[];
  nombre: string;
  inicial: number;
  /** Abrir reproduciendo el video del slide inicial (si lo es). */
  reproducirInicial?: boolean;
  onCerrar: (activa: number) => void;
}) {
  const { principal, acento } = partesNombre(useMarca());
  const [activa, setActiva] = useState(inicial);
  const pistaRef = useRef<HTMLDivElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const activaRef = useRef(inicial);
  activaRef.current = activa;
  const [reproduciendoId, setReproduciendoId] = useState<string | null>(() =>
    reproduccionInicial(items, inicial, reproducirInicial),
  );
  const varias = items.length > 1;
  const itemActivo = items[activa];

  // Al salir del slide del video que suena (dedo, flecha, teclado o botón) se desmonta el iframe:
  // al volver se ve otra vez el poster.
  const idVideoActivo = itemActivo?.tipo === "video" ? itemActivo.id : null;
  const [videoActivoPrevio, setVideoActivoPrevio] = useState(idVideoActivo);
  if (videoActivoPrevio !== idVideoActivo) {
    setVideoActivoPrevio(idVideoActivo);
    setReproduciendoId(null);
  }

  // Un iframe en foco se come ← → y Esc (el listener es de window): el foco vuelve a "Cerrar".
  useEffect(() => {
    if (reproduciendoId) cerrarRef.current?.focus();
  }, [reproduciendoId]);

  // Antes del primer pintado: si no, se ve un instante la primera foto.
  useLayoutEffect(() => {
    const pista = pistaRef.current;
    if (pista) pista.scrollLeft = inicial * pista.clientWidth;
  }, [inicial]);

  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const foco = document.activeElement as HTMLElement | null;
    cerrarRef.current?.focus();

    function alTeclear(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar(activaRef.current);
      else if (e.key === "ArrowRight") irA(activaRef.current + 1);
      else if (e.key === "ArrowLeft") irA(activaRef.current - 1);
    }
    window.addEventListener("keydown", alTeclear);
    return () => {
      window.removeEventListener("keydown", alTeclear);
      document.body.style.overflow = previo;
      foco?.focus();
    };
    // onCerrar cambia en cada render del padre; el listener lee la activa por ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function alDesplazar() {
    const pista = pistaRef.current;
    if (!pista || pista.clientWidth === 0) return;
    const i = Math.round(pista.scrollLeft / pista.clientWidth);
    setActiva(Math.max(0, Math.min(i, items.length - 1)));
  }

  function irA(i: number) {
    const pista = pistaRef.current;
    if (!pista || i < 0 || i >= items.length) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pista.scrollTo({
      left: i * pista.clientWidth,
      behavior: quieto ? "instant" : "smooth",
    });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] overscroll-contain bg-surface pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:flex md:items-center md:justify-center md:bg-text/60 md:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar(activa);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={etiquetaVisor(items, nombre)}
        className="flex h-full w-full flex-col bg-surface md:h-[min(85vh,56rem)] md:max-w-5xl md:overflow-hidden md:rounded-[24px] md:shadow-2"
      >
        <div className="flex shrink-0 items-center justify-between px-4 py-3 md:px-6">
          <span className="font-display text-xl font-semibold tracking-tight text-text" aria-hidden="true">
            {acento ? (
              <>
                {principal} <span className="text-accent">{acento}</span>
              </>
            ) : (
              principal
            )}
          </span>
          <button
            ref={cerrarRef}
            type="button"
            onClick={() => onCerrar(activa)}
            aria-label="Cerrar"
            className="flex h-11 w-11 items-center justify-center rounded-full text-text transition-[background-color,scale] duration-150 ease-out hover:bg-elevated active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            ref={pistaRef}
            onScroll={varias ? alDesplazar : undefined}
            className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
          >
            {items.map((item, i) =>
              item.tipo === "video" ? (
                <div
                  key={claveItem(item)}
                  className="flex h-full w-full shrink-0 snap-center snap-always items-center justify-center p-4 md:p-8"
                >
                  <VideoFacade
                    video={item}
                    reproduciendo={debeMontarIframe(item, i, activa, reproduciendoId)}
                    onReproducir={() => setReproduciendoId(item.id)}
                    titulo={nombre}
                  />
                </div>
              ) : (
                <div key={claveItem(item)} className="relative h-full w-full shrink-0 snap-center snap-always">
                  <Image
                    src={item.url}
                    alt={item.alt || nombre}
                    fill
                    sizes="(min-width: 768px) 1024px, 100vw"
                    className="object-contain md:p-6"
                    // La activa y sus vecinas ya: al deslizar tienen que estar listas.
                    loading={Math.abs(i - activa) <= 1 ? "eager" : "lazy"}
                  />
                </div>
              ),
            )}
          </div>

          {/* Sobre un video no van flechas encima: taparían el reproductor. Ahí van en el pie. */}
          {varias && itemActivo?.tipo !== "video" && (
            <>
              <Flecha hacia="prev" oculta={activa === 0} onClick={() => irA(activa - 1)} item={items[activa - 1]} />
              <Flecha
                hacia="next"
                oculta={activa === items.length - 1}
                onClick={() => irA(activa + 1)}
                item={items[activa + 1]}
              />
            </>
          )}
        </div>

        <PieVisor items={items} activa={activa} onIr={irA} />
      </div>
    </div>,
    document.body,
  );
}

/** Pie del visor: contador y, con un video activo, Anterior/Siguiente en cualquier ancho. */
export function PieVisor({ items, activa, onIr }: { items: ItemGaleria[]; activa: number; onIr: (i: number) => void }) {
  const varias = items.length > 1;
  const conBotones = varias && items[activa]?.tipo === "video";
  const anterior = items[activa - 1];
  const siguiente = items[activa + 1];
  return (
    <div className="flex h-14 shrink-0 items-center justify-center gap-4 text-sm text-muted">
      {conBotones &&
        (anterior ? (
          <BotonPie hacia="prev" item={anterior} onClick={() => onIr(activa - 1)} />
        ) : (
          <span className="h-11 w-11" aria-hidden="true" />
        ))}
      <span aria-live="polite">{varias ? `${activa + 1} / ${items.length}` : ""}</span>
      {conBotones &&
        (siguiente ? (
          <BotonPie hacia="next" item={siguiente} onClick={() => onIr(activa + 1)} />
        ) : (
          <span className="h-11 w-11" aria-hidden="true" />
        ))}
    </div>
  );
}

export function etiquetaFlecha(hacia: "prev" | "next", item?: ItemGaleria) {
  const que = item?.tipo === "video" ? "Video" : "Foto";
  return hacia === "prev" ? `${que} anterior` : `${que} siguiente`;
}

export function Chevron({ hacia }: { hacia: "prev" | "next" }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {hacia === "prev" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

function BotonPie({ hacia, item, onClick }: { hacia: "prev" | "next"; item: ItemGaleria; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiquetaFlecha(hacia, item)}
      className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-text shadow-2 transition-[scale] duration-150 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
    >
      <Chevron hacia={hacia} />
    </button>
  );
}

function Flecha({
  hacia,
  oculta,
  onClick,
  item,
}: {
  hacia: "prev" | "next";
  oculta: boolean;
  onClick: () => void;
  item?: ItemGaleria;
}) {
  if (oculta) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiquetaFlecha(hacia, item)}
      // Sólo desde md: en el celular se desliza con el dedo.
      className={
        "absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-text shadow-2 transition-[scale] duration-150 ease-out active:scale-95 md:flex " +
        (hacia === "prev" ? "left-4" : "right-4")
      }
    >
      <Chevron hacia={hacia} />
    </button>
  );
}
