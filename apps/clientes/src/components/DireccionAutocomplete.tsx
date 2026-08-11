"use client";

import { useEffect, useRef, useState } from "react";
import { Field, Input, Spinner } from "@myd-org/ui";

/**
 * Autocompletado de direcciones argentinas contra /api/geocode (Nominatim).
 *
 * Vive acá y no dentro de cada formulario porque lo usan dos: el domicilio
 * fiscal y las direcciones de envío. Duplicar el debounce, el manejo de
 * teclado y el cierre del desplegable es cómo terminan comportándose distinto.
 *
 * El debounce es de 500 ms y el mínimo de 4 caracteres a propósito: Nominatim
 * pide como máximo 1 request por segundo, y un usuario tipeando rápido con
 * 300 ms genera fácil el doble. El bloqueo sería por IP del servidor, así que
 * dejaría sin autocompletado a TODOS los clientes a la vez.
 */

export interface Sugerencia {
  label: string;
  calle: string;
  ciudad: string;
  provincia: string;
  cp: string;
}

const DEBOUNCE_MS = 500;
const MIN_CARACTERES = 4;

export function DireccionAutocomplete({
  label = "Dirección",
  value,
  onChange,
  onSeleccionar,
  onCargarAMano,
  suspendido,
  placeholder = "Escribí la calle y el número…",
  error,
}: {
  label?: string;
  value: string;
  /** Cambios de texto libre (todavía sin confirmar una sugerencia). */
  onChange: (v: string) => void;
  /** El usuario eligió una sugerencia: trae ciudad, provincia y CP resueltos. */
  onSeleccionar: (s: Sugerencia) => void;
  /**
   * Salida cuando ninguna sugerencia sirve. Se renderiza como última fila del
   * desplegable, y no debajo del input: el desplegable es absoluto y tapa
   * justamente esa zona, así que un link ahí abajo queda inalcanzable en el
   * único momento en que hace falta.
   */
  onCargarAMano?: () => void;
  /**
   * Deja de sugerir. Se activa cuando el usuario eligió cargar a mano: ya dijo
   * que ninguna sugerencia sirve, así que seguir buscando es ruido — y peor, el
   * desplegable se abre sobre los campos que está completando y se los tapa.
   */
  suspendido?: boolean;
  placeholder?: string;
  error?: string;
}) {
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [indice, setIndice] = useState(-1);
  const [buscando, setBuscando] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // El texto que ya se resolvió: evita re-consultar apenas se elige una opción,
  // porque seleccionar cambia el value y dispararía la búsqueda de nuevo.
  const yaResueltoRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  function buscar(texto: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    if (
      suspendido ||
      texto.trim().length < MIN_CARACTERES ||
      yaResueltoRef.current === texto
    ) {
      setSugerencias([]);
      setAbierto(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBuscando(true);
      try {
        const res = await fetch(`/api/geocode?text=${encodeURIComponent(texto)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as Sugerencia[];
        setSugerencias(data);
        setAbierto(data.length > 0);
        setIndice(-1);
      } catch {
        // Abortada o sin red: el usuario puede escribir la dirección a mano.
      } finally {
        setBuscando(false);
      }
    }, DEBOUNCE_MS);
  }

  function elegir(s: Sugerencia) {
    yaResueltoRef.current = s.calle;
    onSeleccionar(s);
    setSugerencias([]);
    setAbierto(false);
    setIndice(-1);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!abierto || sugerencias.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndice((i) => Math.min(i + 1, sugerencias.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndice((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && indice >= 0) {
      e.preventDefault();
      elegir(sugerencias[indice]);
    } else if (e.key === "Escape") {
      setAbierto(false);
      setIndice(-1);
    }
  }

  return (
    <div className="relative">
      <Field label={label} error={error}>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            buscar(e.target.value);
          }}
          onKeyDown={onKeyDown}
          // El blur se demora: sin esto, el clic en una sugerencia cierra la
          // lista antes de que el evento llegue y no se selecciona nada.
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onFocus={() => sugerencias.length > 0 && setAbierto(true)}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={abierto}
          aria-autocomplete="list"
        />
      </Field>

      {/*
        `pointer-events-none` para que la ruedita no se coma el clic: queda
        encima del input y sin esto tapa la zona donde el usuario sigue
        escribiendo. El `label` lo lee el lector de pantalla, que necesita algo
        —una animación sola no comunica nada.
      */}
      {buscando && (
        <span className="pointer-events-none absolute right-3 top-9 text-muted">
          <Spinner size="sm" label="Buscando direcciones" />
        </span>
      )}

      {abierto && sugerencias.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          {sugerencias.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <button
                type="button"
                onMouseDown={() => elegir(s)}
                className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                  i === indice ? "bg-elevated text-primary" : "text-text hover:bg-elevated"
                }`}
              >
                {s.label}
              </button>
            </li>
          ))}

          {/* Última fila: la salida a mano, donde el usuario ya está mirando. */}
          {onCargarAMano && (
            <li className="border-t border-border">
              <button
                type="button"
                onMouseDown={() => {
                  setAbierto(false);
                  setSugerencias([]);
                  onCargarAMano();
                }}
                className="w-full px-4 py-2.5 text-left text-sm font-semibold text-primary transition-colors hover:bg-elevated"
              >
                Ninguna es mi dirección — cargarla a mano
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
