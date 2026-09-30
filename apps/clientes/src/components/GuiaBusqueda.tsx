"use client";

import { forwardRef, type KeyboardEvent } from "react";
import { TEXTOS_GUIA } from "@/lib/busqueda-inteligente/textos";
import { ChispaIcon } from "@/components/catalogo/iconos";

/**
 * Guía del buscador (flag `busqueda-ia`): aparece al enfocar el campo vacío y
 * se va al escribir (vuelve el autocompletado de siempre). Enseña que se puede
 * buscar por código, por necesidad o por ambiente, con ejemplos que se tocan,
 * y suma las búsquedas frecuentes de la tienda.
 *
 * Teclado: desde el campo, ↓ entra a la guía (ver SearchAutocomplete); acá
 * ↑/↓ recorren los ejemplos, Escape vuelve al campo (`onEscape`). Cada ejemplo
 * es un botón: Tab también los recorre.
 */
export const GuiaBusqueda = forwardRef<
  HTMLDivElement,
  {
    id: string;
    /** `null` = todavía cargando (la sección no se muestra hasta tener algo). */
    frecuentes: string[] | null;
    onElegir: (texto: string) => void;
    onEscape: () => void;
  }
>(function GuiaBusqueda({ id, frecuentes, onElegir, onEscape }, ref) {
  const moverFoco = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const botones = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const i = botones.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === "ArrowUp" && i === 0) {
      onEscape();
      return;
    }
    botones[Math.min(Math.max(i + (e.key === "ArrowDown" ? 1 : -1), 0), botones.length - 1)]?.focus();
  };

  const ejemplo = (texto: string) => (
    <li key={texto}>
      <button
        type="button"
        onClick={() => onElegir(texto)}
        aria-label={TEXTOS_GUIA.buscarEjemplo(texto)}
        className="rounded-full border border-border bg-surface px-3 py-1 text-left text-sm text-text transition-colors hover:border-primary hover:bg-elevated focus-visible:border-primary"
      >
        {texto}
      </button>
    </li>
  );

  return (
    <div
      ref={ref}
      id={id}
      role="region"
      aria-label={TEXTOS_GUIA.titulo}
      onKeyDown={moverFoco}
      className="flex flex-col gap-4 p-4 motion-safe:animate-aparecer"
    >
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <ChispaIcon className="h-4 w-4 shrink-0 text-accent" />
        {TEXTOS_GUIA.titulo}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {TEXTOS_GUIA.grupos.map((g) => (
          <section key={g.titulo} aria-label={g.titulo} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-text">{g.titulo}</h3>
            <ul className="flex flex-wrap gap-2">{g.ejemplos.map(ejemplo)}</ul>
          </section>
        ))}
      </div>
      {frecuentes && frecuentes.length > 0 && (
        <section aria-label={TEXTOS_GUIA.frecuentes} className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{TEXTOS_GUIA.frecuentes}</h3>
          <ul className="flex flex-wrap gap-2">{frecuentes.map(ejemplo)}</ul>
        </section>
      )}
    </div>
  );
});
