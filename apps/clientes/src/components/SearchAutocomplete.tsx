"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@myd-org/ui";
import type { Product } from "@/data/products";
import { usePreciosCuenta } from "@/hooks/usePreciosCuenta";
import { aplicarEstadoPrecio } from "@/lib/precios-cuenta-estado";
import { fmtPrecio } from "@/lib/format";
import { nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";
import { LightbulbIcon } from "@/components/catalogo/iconos";
import {
  INTERVALO_PLACEHOLDER_MS,
  hrefBusqueda,
  placeholderBuscador,
  vistaDesplegable,
} from "@/lib/busqueda-inteligente/descubrimiento";
import { GuiaBusqueda } from "./GuiaBusqueda";

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function useDebounced<T>(value: T, delay = 150): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/**
 * Buscador del header. Con `busquedaIa` (flag `busqueda-ia`, lo resuelve el
 * hueco del header) suma el descubrimiento de la búsqueda flexible: el
 * placeholder rota entre un código, una necesidad y un uso (quieto con
 * `prefers-reduced-motion`), y al enfocar el campo vacío aparece la guía con
 * ejemplos y búsquedas frecuentes (ver GuiaBusqueda). Sin el flag, el de
 * siempre.
 */
export function SearchAutocomplete({ busquedaIa = false, extra }: { busquedaIa?: boolean; extra?: ReactNode }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const guiaRef = useRef<HTMLDivElement>(null);
  const idGuia = useId();

  // Placeholder que rota (sólo con el flag, con el campo vacío y sin foco, y
  // nunca con `prefers-reduced-motion`).
  const [indicePlaceholder, setIndicePlaceholder] = useState(0);
  const quieto = !busquedaIa || open || query !== "";
  useEffect(() => {
    if (quieto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setIndicePlaceholder((i) => i + 1), INTERVALO_PLACEHOLDER_MS);
    return () => window.clearInterval(id);
  }, [quieto]);

  // Búsquedas frecuentes: se piden una vez, la primera vez que se abre la guía.
  const [frecuentes, setFrecuentes] = useState<string[] | null>(null);
  const pidioFrecuentes = useRef(false);

  const debouncedQuery = useDebounced(query, 250);
  const [results, setResults] = useState<Product[]>([]);
  // Precio de la lista privada de la cuenta (si la tiene) en las sugerencias.
  const preciosCuenta = usePreciosCuenta(results.map((p) => p.id));
  const [loading, setLoading] = useState(false);

  // Búsqueda server-side sobre el catálogo del CRM (misma regla que /catalogo:
  // por términos, con plurales y relevancia; ver `coincideTexto` en catalog.ts).
  useEffect(() => {
    const q = debouncedQuery.trim();
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      if (q.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/shop/catalogo?q=${encodeURIComponent(q)}&limit=8`,
          { signal: controller.signal },
        );
        const data: Product[] = res.ok ? await res.json() : [];
        if (!cancelled) setResults(Array.isArray(data) ? data : []);
      } catch {
        /* abortado o error de red: ignoramos */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [debouncedQuery]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const submit = (texto = query) => {
    if (!texto.trim()) return;
    setOpen(false);
    // Sólo la consulta: el catálogo aplica su default ("Solo con stock"), como el desplegable.
    router.push(hrefBusqueda(texto, busquedaIa));
  };

  const vista = vistaDesplegable({ busquedaIa, abierto: open, texto: query, textoDebounced: debouncedQuery });
  const showDropdown = vista === "resultados";
  const guiaAbierta = vista === "guia";

  useEffect(() => {
    if (!guiaAbierta || pidioFrecuentes.current) return;
    pidioFrecuentes.current = true;
    fetch("/api/shop/busquedas-frecuentes")
      .then((r) => (r.ok ? r.json() : { busquedas: [] }))
      .then((d: { busquedas?: unknown }) =>
        setFrecuentes(Array.isArray(d.busquedas) ? d.busquedas.filter((x): x is string => typeof x === "string") : []),
      )
      .catch(() => setFrecuentes([]));
  }, [guiaAbierta]);

  const elegirEjemplo = (texto: string) => {
    setQuery(texto);
    submit(texto);
  };

  return (
    <div
      ref={containerRef}
      // Con teclado: si el foco sale del buscador (Tab después del último
      // ejemplo de la guía o de la última sugerencia), el desplegable se cierra.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      className="relative flex w-full max-w-2xl"
    >
      {/* Blanco (surface) con borde y sombra suave, no el relleno elevated: el
          campo se lee como campo, y el borde sale de la tinta del tema. */}
      <div className="flex w-full overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--color-text)_14%,transparent)] bg-surface shadow-[0_1px_2px_rgba(22,40,63,0.06)] focus-within:border-primary">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          ref={inputRef}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            // ↓ entra a la guía; Escape la cierra.
            if (e.key === "ArrowDown" && guiaAbierta) {
              e.preventDefault();
              guiaRef.current?.querySelector("button")?.focus();
            }
            if (e.key === "Escape") setOpen(false);
          }}
          // Corto a propósito: al lado está la lupa, y cualquier texto más
          // largo se cortaba a mitad de palabra en el header angosto. Con la
          // búsqueda inteligente rota entre ejemplos (el que no entra se
          // desvanece con el mask).
          placeholder={placeholderBuscador(busquedaIa, indicePlaceholder)}
          aria-label="Buscar productos"
          // Con el flag, el campo es un combobox: abre la guía o las sugerencias.
          role={busquedaIa ? "combobox" : undefined}
          aria-expanded={busquedaIa ? guiaAbierta || showDropdown : undefined}
          aria-controls={guiaAbierta ? idGuia : undefined}
          // El mask difumina el borde derecho: si el placeholder (o lo tipeado)
          // no entra, se desvanece en vez de cortarse a mitad de palabra.
          className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-sm text-text placeholder:text-muted outline-none [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)]"
        />
        <button
          onClick={() => submit()}
          aria-label="Buscar"
          className="flex shrink-0 items-center gap-2 bg-transparent px-4 text-sm font-medium text-muted transition-colors hover:text-text"
        >
          <SearchIcon />
        </button>
        {/* Acción extra dentro del campo (el botón del asistente), tras un separador. */}
        {extra ? (
          <>
            <span aria-hidden className="my-2 w-px shrink-0 bg-border" />
            {extra}
          </>
        ) : null}
      </div>

      {guiaAbierta && (
        // Mismo caso que las sugerencias (ver abajo).
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-lg border border-border bg-surface shadow-2">
          <GuiaBusqueda
            ref={guiaRef}
            id={idGuia}
            frecuentes={frecuentes}
            onElegir={elegirEjemplo}
            onEscape={() => inputRef.current?.focus()}
          />
        </div>
      )}

      {showDropdown && (
        // En mobile (iOS) tocar un botón no le da foco: el input pierde el foco
        // con relatedTarget null, el onBlur cierra el desplegable antes del
        // click y el toque no navega. preventDefault deja el foco en el input.
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-lg border border-border bg-surface shadow-2">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted">
              {loading ? (
                <p>Buscando…</p>
              ) : (
                <p>Sin resultados para &quot;{debouncedQuery}&quot;</p>
              )}
            </div>
          ) : (
            <ul>
              {results.map((original) => {
                const p = aplicarEstadoPrecio(original, preciosCuenta.get(original.id));
                // Sólo para mostrar: `p.name` no se toca.
                const marca = p.brand ? formatMarca(p.brand) : undefined;
                const { nombre: nombreParaMostrar } = nombreConMarca(p.name, marca);
                return (
                <li key={p.id}>
                  <button
                    onClick={() => { setOpen(false); router.push(`/producto/${p.id}`); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-elevated"
                  >
                    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-elevated text-muted">
                      {p.images?.[0] ? (
                        <Image
                          src={p.images[0].url}
                          alt={p.images[0].alt ?? nombreParaMostrar}
                          fill
                          sizes="44px"
                          className="object-contain p-1"
                        />
                      ) : (
                        <LightbulbIcon className="h-5 w-5 text-muted/50" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{nombreParaMostrar}</span>
                      <span className="block truncate text-xs text-muted">{marca}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-text">
                      {p.precioCuenta === "pendiente" ? (
                        <Skeleton className="h-4 w-14" aria-label="Cargando su precio" />
                      ) : p.precioCuenta === "consulte" ? (
                        "Consulte"
                      ) : (
                        fmtPrecio(p.precioFinal ?? p.price)
                      )}
                    </span>
                  </button>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
