"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Spinner } from "@myd-org/ui";
import { MIN_CARACTERES_LOCALIDAD } from "@/lib/georef";
import { TEXTOS_UBICACION as T } from "@/lib/ubicacion";

/**
 * Sin sesión: localidad (Georef, autocompletado o "Usar mi ubicación") + código postal. No guarda
 * nada por su cuenta: avisa al modal qué localidad se eligió y el modal manda `{ id, cp }` al
 * confirmar (el CP es obligatorio sin sesión). La geolocalización ya deja la localidad aplicada
 * (sin CP) y precarga la búsqueda para que el visitante confirme la localidad e ingrese el CP.
 * El navegador nunca llama a Georef: todo pasa por `/api/ubicacion/*`.
 */
const DEBOUNCE_MS = 400;

export interface LocalidadElegida {
  id: string;
  etiqueta: string;
}

export function FormularioLocalidad({
  elegida,
  onElegir,
  cp,
  onCp,
  errorCp,
  errorLocalidad,
  onGeolocalizada,
  deshabilitado,
}: {
  elegida: LocalidadElegida | null;
  onElegir: (l: LocalidadElegida) => void;
  cp: string;
  onCp: (cp: string) => void;
  errorCp: string | null;
  errorLocalidad: string | null;
  /** La geolocalización aplicó una localidad (sin CP): refrescar el header. */
  onGeolocalizada: () => void;
  deshabilitado: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [opciones, setOpciones] = useState<LocalidadElegida[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [ubicando, setUbicando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
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
        const data = (await res.json().catch(() => null)) as { localidades?: LocalidadElegida[]; error?: string } | null;
        if (!res.ok || !data?.localidades) {
          setOpciones(null);
          setError(data?.error ?? T.errorBusqueda);
        } else {
          setOpciones(data.localidades);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError(T.errorBusqueda);
      } finally {
        if (!ctrl.signal.aborted) setBuscando(false);
      }
    }, DEBOUNCE_MS);
  }

  function elegir(op: LocalidadElegida) {
    onElegir(op);
    setTexto(op.etiqueta);
    setOpciones(null);
    setAviso(null);
  }

  function usarMiUbicacion() {
    setError(null);
    if (!("geolocation" in navigator)) {
      setError(T.sinPermiso);
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
          const data = (await res.json().catch(() => null)) as { localidad?: string; error?: string } | null;
          if (!res.ok || !data?.localidad) {
            setError(data?.error ?? T.errorUbicacion);
            return;
          }
          // La localidad quedó aplicada sin CP: se confirma en la lista y se pide el CP.
          onGeolocalizada();
          setAviso(T.completarCp);
          buscar(data.localidad);
        } catch {
          setError(T.errorUbicacion);
        } finally {
          setUbicando(false);
        }
      },
      // Permiso denegado o sin señal: sin error técnico, se ofrece escribir la localidad.
      () => {
        setUbicando(false);
        setError(T.sinPermiso);
      },
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  return (
    <fieldset className="m-0 min-w-0 space-y-3 border-0 p-0" disabled={deshabilitado}>
      <legend className="mb-2 p-0 text-sm font-medium text-text">{T.legendLocalidad}</legend>

      <Button type="button" variant="outline" onClick={usarMiUbicacion} loading={ubicando} disabled={ubicando}>
        {ubicando ? T.ubicando : T.usarMiUbicacion}
      </Button>

      <div className="relative">
        <Field label={T.etiquetaInput} error={errorLocalidad ?? undefined}>
          <Input
            value={texto}
            onChange={(e) => buscar(e.target.value)}
            placeholder={T.placeholder}
            autoComplete="off"
            aria-describedby="enviar-a-localidad-estado"
          />
        </Field>
        {buscando && (
          <span className="pointer-events-none absolute right-3 top-9 text-muted">
            <Spinner size="sm" label={T.buscando} />
          </span>
        )}
      </div>

      <div id="enviar-a-localidad-estado" aria-live="polite" className="text-sm">
        {error ? (
          <p className="text-danger">{error}</p>
        ) : opciones && opciones.length === 0 && !buscando ? (
          <p className="text-muted">{T.sinResultados}</p>
        ) : aviso ? (
          <p className="text-muted">{aviso}</p>
        ) : null}
      </div>

      {opciones && opciones.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-menu-1 border border-border bg-surface p-1">
          {opciones.map((op) => (
            <li key={op.id}>
              <button
                type="button"
                onClick={() => elegir(op)}
                aria-pressed={elegida?.id === op.id}
                className="w-full rounded-sm px-3 py-2 text-left text-sm text-text transition-colors hover:bg-elevated"
              >
                {op.etiqueta}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Field label={T.etiquetaCp} error={errorCp ?? undefined}>
        <Input
          value={cp}
          onChange={(e) => onCp(e.target.value)}
          placeholder={T.placeholderCp}
          autoComplete="postal-code"
          maxLength={12}
        />
      </Field>
    </fieldset>
  );
}
