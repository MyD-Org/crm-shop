"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchProducts, suggestQuery } from "@/data/products";

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

  const debouncedQuery = useDebounced(query, 150);
  const results = useMemo(() => searchProducts(debouncedQuery), [debouncedQuery]);
  const suggestion = useMemo(
    () => (results.length === 0 ? suggestQuery(debouncedQuery) : null),
    [results, debouncedQuery],
  );

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
          placeholder="Buscar productos, marcas y codigos..."
          className="flex-1 bg-transparent px-4 py-2.5 text-sm text-text placeholder:text-muted outline-none"
        />
        <button
          onClick={submit}
          className="flex items-center gap-2 bg-transparent px-4 text-sm font-medium text-muted transition-colors hover:text-text"
        >
          <SearchIcon />
          Buscar
        </button>
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-lg border border-border bg-surface shadow-2">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted">
              <p>Sin resultados para &quot;{debouncedQuery}&quot;</p>
              {suggestion && (
                <button
                  onClick={() => { setQuery(suggestion); setOpen(true); }}
                  className="mt-1 text-primary hover:underline"
                >
                  Quisiste decir &quot;{suggestion}&quot;?
                </button>
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
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-elevated text-muted">
                      <SearchIcon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">{p.name}</span>
                      <span className="block text-xs text-muted">{p.brand}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-text">
                      ${p.price.toLocaleString("es-AR")}
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
