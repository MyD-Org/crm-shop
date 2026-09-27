"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

/** Cuánto queda a la vista el aviso antes de irse solo. */
export const AVISO_QUITADO_MS = 5_000;

function IconoFoco() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 3.5-2 5.5-2.5 6.5H7.5C7 15.5 5 13.5 5 9a7 7 0 0 1 7-7z" />
    </svg>
  );
}

/** Miniatura del producto quitado; sin foto, el mismo foco que la tarjeta. */
function Miniatura({ src, className = "" }: { src?: string; className?: string }) {
  return (
    <span
      className={`relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-elevated text-accent ring-2 ring-[var(--color-surface-dark)] lg:ring-surface ${className}`}
    >
      {src ? <Image src={src} alt="" fill sizes="32px" className="object-contain p-0.5" /> : <IconoFoco />}
    </span>
  );
}

/**
 * Aviso de "Quitó …" con Deshacer, flotando abajo. En mobile va sobre la barra
 * fija de compra (o al borde, si la barra se retiró porque el resumen está a
 * la vista); en desktop, centrado a 24 px del borde y en claro: abajo suele
 * quedar el footer, que es oscuro, y un aviso oscuro encima no se leía.
 *
 * Siempre montado: la región `role="status"` tiene que existir antes del
 * mensaje para que el lector de pantalla lo anuncie. Se esconde con opacidad
 * y desplazamiento, y sin eventos de puntero.
 *
 * El plazo se reinicia con cada `clave` nueva (otra baja) y se pausa mientras
 * el mouse o el foco están encima.
 */
export function AvisoQuitado({
  texto,
  imagenes,
  visible,
  clave,
  sobreBarra,
  onDeshacer,
  onVencer,
}: {
  texto: string;
  /** Fotos de lo quitado (la última baja primero); se muestran hasta dos. */
  imagenes: (string | undefined)[];
  visible: boolean;
  /** Cambia con cada baja: reinicia el plazo. */
  clave: number;
  /** Mobile: si la barra fija de compra está a la vista (el aviso va encima). */
  sobreBarra: boolean;
  onDeshacer: () => void;
  onVencer: () => void;
}) {
  const [pausado, setPausado] = useState(false);
  // En un ref: el padre pasa una función nueva en cada render.
  const vencer = useRef(onVencer);
  useEffect(() => {
    vencer.current = onVencer;
  });

  useEffect(() => {
    if (!visible || pausado) return;
    const t = window.setTimeout(() => vencer.current(), AVISO_QUITADO_MS);
    return () => window.clearTimeout(t);
  }, [visible, pausado, clave]);

  return (
    <div
      role="status"
      aria-hidden={!visible || undefined}
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
      className={`fixed inset-x-3 z-40 mx-auto flex max-w-[420px] items-center gap-3 rounded-[14px] bg-[var(--color-surface-dark)] py-2 pl-2 pr-2 text-sm text-[var(--color-on-surface-dark)] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] lg:border lg:border-border-strong lg:bg-surface lg:text-text lg:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.35)] transition-[opacity,translate,bottom] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none lg:bottom-6 ${
        sobreBarra ? "bottom-[calc(5.5rem+env(safe-area-inset-bottom))]" : "bottom-[calc(1rem+env(safe-area-inset-bottom))]"
      } ${visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"}`}
    >
      {texto && (
        <>
          <span className="flex shrink-0" aria-hidden="true">
            {imagenes.slice(0, 2).map((src, i) => (
              <Miniatura key={i} src={src} className={i > 0 ? "-ml-3" : ""} />
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate">{texto}</span>
          <button
            type="button"
            onClick={onDeshacer}
            tabIndex={visible ? undefined : -1}
            className="h-10 shrink-0 rounded-[10px] px-3 font-extrabold text-[var(--color-marca-sobre-oscuro)] transition-colors hover:bg-white/10 lg:text-accent lg:hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            Deshacer
          </button>
        </>
      )}
    </div>
  );
}
