"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { cn } from "@myd-org/ui";
import type { ProductImage } from "@/data/products";
import { LightbulbIcon } from "@/components/catalogo/iconos";

/**
 * Galería de la ficha con las fotos del overlay del CRM (portada = [0]), ya
 * filtradas a los hosts de medios permitidos. Sin fotos, el placeholder de
 * siempre. Con más de una, miniaturas para elegir cuál se ve en grande.
 *
 * La foto grande es una pista horizontal con scroll-snap: en el celular se
 * pasa de foto deslizando el dedo (con la inercia y el rebote nativos, sin
 * JS de gestos) y en desktop con el trackpad. Las miniaturas desplazan la
 * pista con scroll suave, así el cambio siempre es el mismo deslizamiento
 * lateral que el del dedo (y no un corte). Con reduced motion el salto es
 * instantáneo. La foto activa sale de la posición del scroll: una sola
 * fuente de verdad para el dedo, el trackpad, las flechas y las miniaturas.
 */
export function GaleriaProducto({ fotos, nombre }: { fotos?: ProductImage[]; nombre: string }) {
  const [activa, setActiva] = useState(0);
  const pistaRef = useRef<HTMLDivElement>(null);
  const lista = fotos ?? [];
  const varias = lista.length > 1;

  function alDesplazar() {
    const pista = pistaRef.current;
    if (!pista || pista.clientWidth === 0) return;
    const i = Math.round(pista.scrollLeft / pista.clientWidth);
    setActiva(Math.max(0, Math.min(i, lista.length - 1)));
  }

  function irA(i: number) {
    const pista = pistaRef.current;
    if (!pista) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    pista.scrollTo({ left: i * pista.clientWidth, behavior: quieto ? "instant" : "smooth" });
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="relative aspect-square min-w-0 overflow-hidden rounded-[24px] border border-border bg-surface">
        {lista.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <LightbulbIcon className="h-48 w-48 text-muted/20" />
          </div>
        ) : (
          <div
            ref={pistaRef}
            onScroll={varias ? alDesplazar : undefined}
            // Con varias fotos la pista es foco de teclado: las flechas la
            // desplazan (nativo) y el snap la deja en una foto entera.
            tabIndex={varias ? 0 : undefined}
            role={varias ? "region" : undefined}
            aria-label={varias ? "Fotos del producto, deslice para ver más" : undefined}
            // overscroll-x-contain: al llegar a la última foto, el gesto no
            // sigue de largo como "atrás" del navegador.
            className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)]"
          >
            {lista.map((f, i) => (
              <div key={f.url} className="relative h-full w-full shrink-0 snap-center snap-always">
                <Image
                  src={f.url}
                  alt={f.alt || nombre}
                  fill
                  // La galería ocupa ~5/11 del contenido desde lg; debajo, todo el ancho.
                  sizes="(min-width: 1024px) 45vw, 100vw"
                  className="object-contain p-6"
                  // La portada es el elemento más grande de la ficha (LCP).
                  preload={i === 0}
                  // Las vecinas de la activa se cargan ya: al deslizar tienen
                  // que estar listas. El resto, cuando haga falta. (La portada
                  // no lleva `loading`: con `preload` no se combina.)
                  loading={i === 0 ? undefined : Math.abs(i - activa) <= 1 ? "eager" : "lazy"}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {varias && (
        <ul className="flex min-w-0 gap-2 overflow-x-auto pb-1" aria-label="Fotos del producto">
          {lista.map((f, i) => (
            <li key={f.url} className="shrink-0">
              <button
                type="button"
                onClick={() => irA(i)}
                aria-label={`Ver foto ${i + 1} de ${lista.length}`}
                aria-pressed={i === activa}
                className={cn(
                  "relative block h-16 w-16 overflow-hidden rounded-xl border bg-surface transition-[border-color,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] motion-reduce:active:scale-100",
                  i === activa ? "border-primary" : "border-border hover:border-muted",
                )}
              >
                <Image src={f.url} alt="" fill sizes="64px" className="object-contain p-1" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
