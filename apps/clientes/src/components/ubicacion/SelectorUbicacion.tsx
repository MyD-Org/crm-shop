"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, Field, Input, Spinner } from "@myd-org/ui";
import { MIN_CARACTERES_LOCALIDAD } from "@/lib/georef";
import { TEXTOS_UBICACION } from "@/lib/ubicacion";

/**
 * Botón + modal para ubicar al visitante: "Usar mi ubicación" (geolocalización del navegador, con
 * permiso) o escribir su localidad con autocompletado. Todo pasa por `/api/ubicacion/*` (el
 * navegador nunca llama a Georef) y el servidor guarda la cookie `shop_ubicacion`; después se
 * refresca la ruta para que el servidor vuelva a renderizar con la ubicación nueva.
 *
 * Sirve de disparador en el encabezado ("Cambiar ubicación") y en la ficha ("Ingrese su
 * localidad"): cada uno monta el suyo.
 */
const DEBOUNCE_MS = 400;

interface Opcion {
  id: string;
  etiqueta: string;
}

export function SelectorUbicacion({
  children,
  className = "",
  conUbicacion = false,
}: {
  /** Contenido del botón que abre el modal. */
  children: ReactNode;
  className?: string;
  /** Con ubicación guardada se ofrece además quitarla. */
  conUbicacion?: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const botonRef = useRef<HTMLButtonElement>(null);
  const [texto, setTexto] = useState("");
  const [opciones, setOpciones] = useState<Opcion[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [ubicando, setUbicando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  const cambiarAbierto = (abrir: boolean) => {
    setAbierto(abrir);
    if (!abrir) {
      setTexto("");
      setOpciones(null);
      setError(null);
      requestAnimationFrame(() => botonRef.current?.focus());
    }
  };

  function terminar() {
    cambiarAbierto(false);
    router.refresh();
  }

  function buscar(valor: string) {
    setTexto(valor);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    if (valor.trim().length < MIN_CARACTERES_LOCALIDAD) {
      setOpciones(null);
      setBuscando(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBuscando(true);
      try {
        const res = await fetch(`/api/ubicacion/localidades?q=${encodeURIComponent(valor.trim())}`, {
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => null)) as { localidades?: Opcion[]; error?: string } | null;
        if (!res.ok || !data?.localidades) {
          setOpciones(null);
          setError(data?.error ?? TEXTOS_UBICACION.errorBusqueda);
        } else {
          setOpciones(data.localidades);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError(TEXTOS_UBICACION.errorBusqueda);
      } finally {
        if (!ctrl.signal.aborted) setBuscando(false);
      }
    }, DEBOUNCE_MS);
  }

  async function elegir(op: Opcion) {
    setError(null);
    try {
      const res = await fetch("/api/ubicacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: op.id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? TEXTOS_UBICACION.errorBusqueda);
        return;
      }
      terminar();
    } catch {
      setError(TEXTOS_UBICACION.errorBusqueda);
    }
  }

  function usarMiUbicacion() {
    setError(null);
    if (!("geolocation" in navigator)) {
      setError(TEXTOS_UBICACION.sinPermiso);
      return;
    }
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/ubicacion/coordenadas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            setError(data?.error ?? TEXTOS_UBICACION.errorUbicacion);
            return;
          }
          terminar();
        } catch {
          setError(TEXTOS_UBICACION.errorUbicacion);
        } finally {
          setUbicando(false);
        }
      },
      // Permiso denegado o sin señal: sin error técnico, se ofrece escribir la localidad.
      () => {
        setUbicando(false);
        setError(TEXTOS_UBICACION.sinPermiso);
      },
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  async function quitar() {
    await fetch("/api/ubicacion", { method: "DELETE" }).catch(() => null);
    terminar();
  }

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${className}`}
      >
        {children}
      </button>
      <Dialog
        open={abierto}
        onOpenChange={cambiarAbierto}
        title={TEXTOS_UBICACION.titulo}
        description={TEXTOS_UBICACION.descripcion}
        size="md"
      >
        <div className="space-y-4">
          <button
            type="button"
            onClick={usarMiUbicacion}
            disabled={ubicando}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-semibold text-text transition-colors hover:bg-elevated disabled:opacity-60"
          >
            {ubicando && <Spinner size="sm" label={TEXTOS_UBICACION.ubicando} />}
            {ubicando ? TEXTOS_UBICACION.ubicando : TEXTOS_UBICACION.usarMiUbicacion}
          </button>

          <div className="relative">
            <Field label={TEXTOS_UBICACION.etiquetaInput}>
              <Input
                value={texto}
                onChange={(e) => buscar(e.target.value)}
                placeholder={TEXTOS_UBICACION.placeholder}
                autoComplete="off"
                aria-describedby="ubicacion-estado"
              />
            </Field>
            {buscando && (
              <span className="pointer-events-none absolute right-3 top-9 text-muted">
                <Spinner size="sm" label={TEXTOS_UBICACION.buscando} />
              </span>
            )}
          </div>

          <div id="ubicacion-estado" aria-live="polite" className="text-sm">
            {error ? (
              <p className="text-danger">{error}</p>
            ) : opciones && opciones.length === 0 && !buscando ? (
              <p className="text-muted">{TEXTOS_UBICACION.sinResultados}</p>
            ) : null}
          </div>

          {opciones && opciones.length > 0 && (
            <ul className="max-h-64 overflow-y-auto rounded-menu-1 border border-border bg-surface p-1">
              {opciones.map((op) => (
                <li key={op.id}>
                  <button
                    type="button"
                    onClick={() => elegir(op)}
                    className="w-full rounded-sm px-3 py-2 text-left text-sm text-text transition-colors hover:bg-elevated"
                  >
                    {op.etiqueta}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {conUbicacion && (
            <button
              type="button"
              onClick={quitar}
              className="text-sm font-semibold text-muted underline underline-offset-2 hover:no-underline"
            >
              {TEXTOS_UBICACION.quitar}
            </button>
          )}
        </div>
      </Dialog>
    </>
  );
}
