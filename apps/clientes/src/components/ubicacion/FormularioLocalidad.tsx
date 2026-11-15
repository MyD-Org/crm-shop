"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, RadioGroup, Spinner } from "@myd-org/ui";
import { urlGeocode, type Sugerencia } from "@/components/DireccionAutocomplete";
import { MIN_CARACTERES_LOCALIDAD } from "@/lib/georef";
import { TEXTOS_UBICACION as T } from "@/lib/ubicacion";

/** Mínimo para consultar: con 2 o 3 caracteres sólo responde una abreviatura del comercio. */
const MIN_CARACTERES_ABREVIATURA = 2;
/** Nominatim pide ≤ 1 request por segundo: búsqueda de direcciones más espaciada (ver DireccionAutocomplete). */
const MIN_CARACTERES_DIRECCION = 4;
const DEBOUNCE_LOCALIDAD_MS = 400;
const DEBOUNCE_DIRECCION_MS = 500;

/**
 * "Enviar a" del modal, sin dirección guardada (estilo apps de delivery): la ubicación vigente como
 * opción marcada, UN buscador y "Usar mi ubicación actual" como link.
 *
 * - Buscador: con el envío por zona (`conCalle`) y un número en el texto busca direcciones (`/api/geocode`,
 *   cada sugerencia trae su `geoToken`); si no, localidades (`/api/ubicacion/localidades`). Elegir un
 *   resultado lo deja como la opción marcada; se guarda recién al confirmar.
 * - "Usar mi ubicación actual" ya deja la elección aplicada (cookie): lo detectado pasa a ser la opción
 *   marcada para que el visitante vea qué se detectó y confirme.
 * El navegador nunca llama a Georef ni a Nominatim: todo pasa por las rutas del Shop.
 */
export interface LocalidadElegida {
  id: string;
  etiqueta: string;
}

/** Lo que queda marcado en "Enviar a". `detectada` y `actual` ya están guardadas: confirmar sólo cierra. */
export type SeleccionEnvio =
  | { tipo: "actual"; titulo: string; detalle?: string }
  | { tipo: "detectada"; titulo: string; detalle?: string; calle?: string; geoToken?: string }
  | { tipo: "localidad"; id: string; titulo: string }
  | { tipo: "calle"; calle: string; geoToken: string; titulo: string; detalle?: string };

type Resultado =
  | { tipo: "localidad"; id: string; etiqueta: string }
  | { tipo: "calle"; calle: string; geoToken: string; etiqueta: string; localidad: string };

export function FormularioLocalidad({
  seleccion,
  onSeleccion,
  valor,
  opcion,
  onValor,
  errorLocalidad,
  onGeolocalizada,
  deshabilitado,
  conCalle = false,
}: {
  seleccion: SeleccionEnvio | null;
  onSeleccion: (s: SeleccionEnvio) => void;
  /** Valor del radio marcado en todo el modal y el de esta opción. */
  valor: string;
  opcion: string;
  onValor: (v: string) => void;
  errorLocalidad: string | null;
  /** La geolocalización aplicó una ubicación (cookie): el modal la marca y refresca el header. */
  onGeolocalizada: (s: SeleccionEnvio) => void;
  deshabilitado: boolean;
  /** Envío por zona: el buscador también encuentra calle y altura. */
  conCalle?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
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

  function buscar(valorTexto: string) {
    setTexto(valorTexto);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    const q = valorTexto.trim();
    const porDireccion = conCalle && /\d/.test(q);
    if (q.length < (porDireccion ? MIN_CARACTERES_DIRECCION : MIN_CARACTERES_ABREVIATURA)) {
      setResultados(null);
      setBuscando(false);
      return;
    }
    debounceRef.current = setTimeout(
      async () => {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        setBuscando(true);
        try {
          setResultados(porDireccion ? await buscarDirecciones(q, ctrl.signal) : await buscarLocalidades(q, ctrl.signal));
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            setResultados(null);
            setError(T.errorBusqueda);
          }
        } finally {
          if (!ctrl.signal.aborted) setBuscando(false);
        }
      },
      porDireccion ? DEBOUNCE_DIRECCION_MS : DEBOUNCE_LOCALIDAD_MS,
    );
  }

  function elegir(r: Resultado) {
    onSeleccion(
      r.tipo === "localidad"
        ? { tipo: "localidad", id: r.id, titulo: r.etiqueta }
        : { tipo: "calle", calle: r.calle, geoToken: r.geoToken, titulo: r.calle, detalle: r.localidad },
    );
    setTexto("");
    setResultados(null);
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
            | { localidad?: string; calle?: string; geoToken?: string; error?: string }
            | null;
          if (!res.ok || !data?.localidad) {
            setError(data?.error ?? T.errorUbicacion);
            return;
          }
          // Ya quedó aplicada (cookie): pasa a ser la opción marcada, con lo que se detectó a la vista.
          setTexto("");
          setResultados(null);
          onGeolocalizada(
            data.calle
              ? {
                  tipo: "detectada",
                  titulo: data.calle,
                  detalle: data.localidad,
                  ...(data.geoToken ? { calle: data.calle, geoToken: data.geoToken } : {}),
                }
              : { tipo: "detectada", titulo: data.localidad },
          );
        } catch {
          setError(T.errorUbicacion);
        } finally {
          setUbicando(false);
        }
      },
      // Permiso denegado (el navegador no vuelve a preguntar: hay que explicar cómo habilitarlo) o sin
      // señal / ubicación apagada en el dispositivo. En los dos casos se ofrece escribirla.
      (err) => {
        setUbicando(false);
        setError(err.code === err.PERMISSION_DENIED ? T.ubicacionBloqueada : T.ubicacionNoDisponible);
      },
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  const opciones = seleccion
    ? [
        {
          value: opcion,
          label: seleccion.titulo,
          ...("detalle" in seleccion && seleccion.detalle ? { description: seleccion.detalle } : {}),
          ...(seleccion.tipo === "actual"
            ? { badge: { label: T.actual } }
            : seleccion.tipo === "detectada"
              ? { badge: { label: T.detectada } }
              : {}),
        },
      ]
    : [];

  return (
    // flex + gap y no space-y: el margen de space-y no le gana al m-0 del fieldset del RadioGroup y el
    // buscador quedaba pegado a la opción marcada (mismo caso que en VistaEnviarA).
    <div className="flex min-w-0 flex-col gap-3">
      {opciones.length > 0 ? (
        <RadioGroup
          legend={T.legendEnviarA}
          name="enviar-a-ubicacion"
          options={opciones}
          value={valor}
          onValueChange={onValor}
          disabled={deshabilitado}
        />
      ) : (
        <p className="text-sm font-medium text-text">{T.legendEnviarA}</p>
      )}

      <div className="relative">
        <Input
          value={texto}
          onChange={(e) => buscar(e.target.value)}
          placeholder={
            conCalle ? (seleccion ? T.buscarOtraDireccion : T.buscarDireccion) : seleccion ? T.buscarOtraLocalidad : T.buscarLocalidad
          }
          aria-label={conCalle ? T.buscarDireccion : T.buscarLocalidad}
          autoComplete="off"
          disabled={deshabilitado}
          aria-describedby="enviar-a-localidad-estado"
        />
        {buscando && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">
            <Spinner size="sm" label={T.buscando} />
          </span>
        )}
      </div>

      {resultados && resultados.length > 0 && (
        <ul className="max-h-56 overflow-y-auto rounded-menu-1 border border-border bg-surface p-1">
          {resultados.map((r) => (
            <li key={r.tipo === "localidad" ? `l:${r.id}` : `c:${r.geoToken}`}>
              <button
                type="button"
                onClick={() => elegir(r)}
                className="w-full rounded-sm px-3 py-2 text-left text-sm text-text transition-colors hover:bg-elevated"
              >
                {r.etiqueta}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div id="enviar-a-localidad-estado" aria-live="polite" className="text-sm empty:hidden">
        {error || errorLocalidad ? (
          <p className="text-danger">{error ?? errorLocalidad}</p>
        ) : resultados && resultados.length === 0 && !buscando ? (
          <p className="text-muted">{conCalle && /\d/.test(texto) ? T.sinDirecciones : T.sinResultados}</p>
        ) : null}
      </div>

      {/* En un div: dentro del flex en columna el botón se estiraría a todo el ancho. */}
      <div>
        <Button
          type="button"
          variant="link"
          size="inline"
          onClick={usarMiUbicacion}
          loading={ubicando}
          disabled={ubicando || deshabilitado}
        >
          {ubicando ? T.ubicando : T.usarMiUbicacionActual}
        </Button>
      </div>
    </div>
  );
}

async function buscarLocalidades(q: string, signal: AbortSignal): Promise<Resultado[] | null> {
  const res = await fetch(`/api/ubicacion/localidades?q=${encodeURIComponent(q)}`, { signal });
  const data = (await res.json().catch(() => null)) as { localidades?: LocalidadElegida[]; error?: string } | null;
  if (!res.ok || !data?.localidades) throw new Error(data?.error ?? "busqueda");
  // Con menos de 4 letras sólo responde una abreviatura del comercio: sin nada, no es "sin resultados".
  if (data.localidades.length === 0 && q.length < MIN_CARACTERES_LOCALIDAD) return null;
  return data.localidades.map((l) => ({ tipo: "localidad" as const, id: l.id, etiqueta: l.etiqueta }));
}

async function buscarDirecciones(q: string, signal: AbortSignal): Promise<Resultado[]> {
  const res = await fetch(urlGeocode(q, "AR"), { signal });
  if (!res.ok) throw new Error("geocode");
  const data = (await res.json().catch(() => null)) as Sugerencia[] | { sugerencias?: Sugerencia[] } | null;
  const lista = Array.isArray(data) ? data : (data?.sugerencias ?? []);
  // Sólo las que el servidor ubicó (con token): son las que permiten cotizar el envío exacto.
  return lista
    .filter((s): s is Sugerencia & { geoToken: string } => Boolean(s.calle && s.geoToken))
    .map((s) => ({ tipo: "calle" as const, calle: s.calle, geoToken: s.geoToken, etiqueta: s.label, localidad: s.ciudad }));
}
