"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Product } from "@/data/products";
import { fmtMonto } from "@/lib/cuotas-textos";
import { LightbulbIcon } from "@/components/catalogo/iconos";

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

export function SearchAutocomplete() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounced(query, 250);
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  // Búsqueda server-side contra Alegra (filtra por `name`, substring).
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

  const submit = () => {
    if (!query.trim()) return;
    setOpen(false);
    router.push(`/catalogo?q=${encodeURIComponent(query.trim())}`);
  };

  const showDropdown = open && debouncedQuery.trim().length > 0;

  return (
    <div ref={containerRef} className="relative flex w-full max-w-2xl">
      <div className="flex w-full overflow-hidden rounded-lg border border-border bg-elevated focus-within:border-primary">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          // Corto a propósito: al lado está la lupa, y cualquier texto más
          // largo se cortaba a mitad de palabra en el header angosto.
          placeholder="Buscar"
          // El mask difumina el borde derecho: si el placeholder (o lo tipeado)
          // no entra, se desvanece en vez de cortarse a mitad de palabra.
          className="min-w-0 flex-1 bg-transparent px-4 py-2.5 text-sm text-text placeholder:text-muted outline-none [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)]"
        />
        <button
          onClick={submit}
          aria-label="Buscar"
          className="flex shrink-0 items-center gap-2 bg-transparent px-4 text-sm font-medium text-muted transition-colors hover:text-text"
        >
          <SearchIcon />
        </button>
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-lg border border-border bg-surface shadow-2">
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
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => { setOpen(false); router.push(`/producto/${p.id}`); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-elevated"
                  >
                    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-elevated text-muted">
                      {p.images?.[0] ? (
                        <Image
                          src={p.images[0].url}
                          alt={p.images[0].alt ?? p.name}
                          fill
                          sizes="44px"
                          className="object-contain p-1"
                        />
                      ) : (
                        <LightbulbIcon className="h-5 w-5 text-muted/50" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{p.name}</span>
                      <span className="block truncate text-xs text-muted">{p.brand}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-text">
                      {fmtMonto(p.precioFinal ?? p.price)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
