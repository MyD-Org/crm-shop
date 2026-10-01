"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import type { ProductImage } from "@/data/products";

/**
 * Visor de fotos a pantalla completa de la ficha (como el de Mercado Libre):
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
 * Va por portal al `<body>`: dentro de la ficha, cualquier ancestro con
 * transform u overflow lo recortaría.
 */
export function VisorFotos({
  fotos,
  nombre,
  inicial,
  onCerrar,
}: {
  fotos: ProductImage[];
  nombre: string;
  inicial: number;
  onCerrar: (activa: number) => void;
}) {
  const [activa, setActiva] = useState(inicial);
  const pistaRef = useRef<HTMLDivElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const activaRef = useRef(inicial);
  activaRef.current = activa;
  const varias = fotos.length > 1;

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
    setActiva(Math.max(0, Math.min(i, fotos.length - 1)));
  }

  function irA(i: number) {
    const pista = pistaRef.current;
    if (!pista || i < 0 || i >= fotos.length) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pista.scrollTo({ left: i * pista.clientWidth, behavior: quieto ? "instant" : "smooth" });
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
        aria-label={`Fotos de ${nombre}`}
        className="flex h-full w-full flex-col bg-surface md:h-[min(85vh,56rem)] md:max-w-5xl md:overflow-hidden md:rounded-[24px] md:shadow-2"
      >
        <div className="flex shrink-0 items-center justify-between px-4 py-3 md:px-6">
          <span className="font-display text-xl font-semibold tracking-tight text-text" aria-hidden="true">
            Central <span className="text-accent">Led</span>
          </span>
          <button
            ref={cerrarRef}
            type="button"
            onClick={() => onCerrar(activa)}
            aria-label="Cerrar"
            className="flex h-11 w-11 items-center justify-center rounded-full text-text transition-[background-color,scale] duration-150 ease-out hover:bg-elevated active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
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
            {fotos.map((f, i) => (
              <div key={f.url} className="relative h-full w-full shrink-0 snap-center snap-always">
                <Image
                  src={f.url}
                  alt={f.alt || nombre}
                  fill
                  sizes="(min-width: 768px) 1024px, 100vw"
                  className="object-contain md:p-6"
                  // La activa y sus vecinas ya: al deslizar tienen que estar listas.
                  loading={Math.abs(i - activa) <= 1 ? "eager" : "lazy"}
                />
              </div>
            ))}
          </div>

          {varias && (
            <>
              <Flecha hacia="prev" oculta={activa === 0} onClick={() => irA(activa - 1)} />
              <Flecha hacia="next" oculta={activa === fotos.length - 1} onClick={() => irA(activa + 1)} />
            </>
          )}
        </div>

        <div className="flex h-12 shrink-0 items-center justify-center text-sm text-muted" aria-live="polite">
          {varias ? `${activa + 1} / ${fotos.length}` : ""}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Flecha({ hacia, oculta, onClick }: { hacia: "prev" | "next"; oculta: boolean; onClick: () => void }) {
  if (oculta) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={hacia === "prev" ? "Foto anterior" : "Foto siguiente"}
      // Sólo desde md: en el celular se desliza con el dedo.
      className={
        "absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-text shadow-2 transition-[scale] duration-150 ease-out active:scale-95 md:flex " +
        (hacia === "prev" ? "left-4" : "right-4")
      }
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {hacia === "prev" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
      </svg>
    </button>
  );
}
