"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/*
 * Strings literales para que Tailwind las genere: se agregan dinámicamente
 * en el cliente, post-hidrato, así que el scanner tiene que verlas acá.
 */
const CLASES_OCULTAS = "opacity-0 translate-y-5";
const CLASES_TRANSICION = "transition-all duration-700 ease-[cubic-bezier(.2,.7,.2,1)]";

/**
 * Reveal on-scroll (progressive enhancement). El HTML del server renderiza el
 * contenido SIEMPRE VISIBLE (SEO / sin JS); recién tras hidratar, si hay
 * IntersectionObserver y el usuario no pidió reduced motion, el wrapper se
 * oculta y se revela una única vez al entrar en viewport. Nunca se re-oculta
 * al scrollear para arriba.
 *
 * Lo que ya está en pantalla al hidratar NO se toca: ocultarlo para volver a
 * mostrarlo parpadeaba y ataba la foto del hero (el LCP) a que terminara de
 * cargar el JS, que en un celular son segundos.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    // Sin transición todavía: el estado oculto inicial aplica de golpe (si
    // agregáramos ambas juntas, el visible→oculto animaría en vez de snap).
    el.classList.add(...CLASES_OCULTAS.split(" "));

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          el.classList.add(...CLASES_TRANSICION.split(" "));
          el.classList.remove(...CLASES_OCULTAS.split(" "));
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
