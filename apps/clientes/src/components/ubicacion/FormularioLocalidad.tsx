"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Field, Input, Spinner } from "@myd-org/ui";
import { DireccionAutocomplete } from "@/components/DireccionAutocomplete";
import type { CalleElegida } from "@/lib/enviar-a";
import { MIN_CARACTERES_LOCALIDAD } from "@/lib/georef";

/** Mínimo para consultar: con 2 o 3 caracteres sólo responde una abreviatura del comercio. */
const MIN_CARACTERES_ABREVIATURA = 2;
import { TEXTOS_UBICACION as T } from "@/lib/ubicacion";

/**
 * Sin sesión: la localidad (Georef, autocompletado o "Usar mi ubicación"). No se pide código
 * postal: la zona, la disponibilidad y el envío salen de la provincia de la localidad. No guarda
 * nada por su cuenta: avisa al modal qué localidad se eligió y el modal manda `{ id }` al
 * confirmar. La geolocalización ya deja la localidad aplicada (cookie) y completa localidad y calle
 * para que el visitante vea qué se detectó y confirme o corrija, como en las apps de delivery.
 * El navegador nunca llama a Georef: todo pasa por `/api/ubicacion/*`.
 */
const DEBOUNCE_MS = 400;

export interface LocalidadElegida {
  id: string;
  etiqueta: string;
}

/** Lo que detectó «Usar mi ubicación» (ya aplicado en la cookie). */
export interface UbicacionDetectada {
  localidad: LocalidadElegida | null;
  etiquetaLocalidad: string;
  calle: string | null;
}

export function FormularioLocalidad({
  elegida,
  onElegir,
  errorLocalidad,
  onGeolocalizada,
  deshabilitado,
  conCalle = false,
  calle = null,
  onCalle,
  errorCalle = null,
}: {
  elegida: LocalidadElegida | null;
  onElegir: (l: LocalidadElegida) => void;
  errorLocalidad: string | null;
  /** La geolocalización aplicó una ubicación (cookie): el modal la muestra para confirmar. */
  onGeolocalizada: (d: UbicacionDetectada) => void;
  deshabilitado: boolean;
  /** Envío por zona: después de la localidad se puede indicar la calle y altura (opcional). */
  conCalle?: boolean;
  calle?: CalleElegida | null;
  /** null = el texto cambió y ya no es una sugerencia elegida (el token deja de valer). */
  onCalle?: (c: CalleElegida | null, texto: string) => void;
  errorCalle?: string | null;
}) {
  const [textoCalle, setTextoCalle] = useState(calle?.calle ?? "");
  const [detectada, setDetectada] = useState(false);
  const [texto, setTexto] = useState(elegida?.etiqueta ?? "");
  const [opciones, setOpciones] = useState<LocalidadElegida[] | null>(null);
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

  function buscar(valor: string) {
    setTexto(valor);
    setDetectada(false);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    // Desde 2 caracteres se consulta igual: una abreviatura del comercio ("mdp") puede responder. Si no
    // responde nada con menos de 4, no se muestra "sin resultados" (como siempre).
    if (valor.trim().length < MIN_CARACTERES_ABREVIATURA) {
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
          setOpciones(data.localidades.length === 0 && valor.trim().length < MIN_CARACTERES_LOCALIDAD ? null : data.localidades);
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
    // Otra localidad: la calle anterior ya no corresponde.
    setTextoCalle("");
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
          const data = (await res.json().catch(() => null)) as
            | { localidad?: string; id?: string; calle?: string; error?: string }
            | null;
          if (!res.ok || !data?.localidad) {
            setError(data?.error ?? T.errorUbicacion);
            return;
          }
          // Ya quedó aplicada (cookie). Se completan los campos con lo detectado para que lo vea y confirme.
          setTexto(data.localidad);
          setTextoCalle(data.calle ?? "");
          setOpciones(null);
          setDetectada(true);
          onGeolocalizada({
            localidad: data.id ? { id: data.id, etiqueta: data.localidad } : null,
            etiquetaLocalidad: data.localidad,
            calle: data.calle ?? null,
          });
        } catch {
          setError(T.errorUbicacion);
        } finally {
          setUbicando(false);
        }
      },
      // Permiso denegado (el navegador no vuelve a preguntar: hay que explicar cómo habilitarlo) o sin
      // señal / ubicación apagada en el dispositivo. En los dos casos se ofrece escribir la localidad.
      (err) => {
        setUbicando(false);
        setError(err.code === err.PERMISSION_DENIED ? T.ubicacionBloqueada : T.ubicacionNoDisponible);
      },
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  return (
    <fieldset className="min-w-0 space-y-3 border-0 p-0" disabled={deshabilitado}>
      <legend className="mb-2 p-0 text-sm font-medium text-text">{T.legendLocalidad}</legend>

      <Button type="button" variant="outline" onClick={usarMiUbicacion} loading={ubicando} disabled={ubicando}>
        {ubicando ? T.ubicando : T.usarMiUbicacion}
      </Button>

      {detectada && (
        <Alert tone="success" role="status" title={T.ubicacionDetectada}>
          {T.ubicacionDetectadaAyuda}
        </Alert>
      )}

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
        ) : null}
      </div>

      {conCalle && (elegida || detectada) && !opciones?.length && (
        <DireccionAutocomplete
          label={T.etiquetaCalle}
          placeholder={T.placeholderCalle}
          ayuda={T.ayudaCalle}
          value={textoCalle}
          ciudad={nombreDeLocalidad(elegida?.etiqueta ?? texto)}
          error={errorCalle ?? undefined}
          onChange={(v) => {
            setTextoCalle(v);
            setDetectada(false);
            onCalle?.(null, v);
          }}
          onSeleccionar={(s) => {
            setTextoCalle(s.calle);
            onCalle?.(s.geoToken ? { calle: s.calle, geoToken: s.geoToken } : null, s.calle);
          }}
        />
      )}

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
    </fieldset>
  );
}

/** La etiqueta puede traer la provincia o el departamento ("Mar del Plata, Buenos Aires"): para acotar la calle va sólo la localidad. */
function nombreDeLocalidad(etiqueta: string): string {
  return etiqueta.split(",")[0]?.trim() ?? etiqueta;
}
