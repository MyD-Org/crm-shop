"use client"

import { useEffect, useId, useState } from "react"
import { Chip, Field, Input } from "@myd-org/ui"
import { normalizarBusqueda } from "@/lib/georef"

// Selector múltiple de "Ciudades de envío": chips con lo elegido + buscador de localidades de
// Georef (vía /api/admin/envios/localidades). Agrega el nombre de la localidad (sin provincia).
// Lo ya guardado se muestra como chip aunque no venga de Georef (ej. un nombre de provincia).

type Sugerencia = { id: string; nombre: string; etiqueta: string }
type Estado = "inactivo" | "corto" | "cargando" | "ok" | "error"

const MIN_CARACTERES = 4
const DEBOUNCE_MS = 300

export function CiudadesEnvioSelector({
  label = "Ciudades de envío",
  value,
  onChange,
  error,
}: {
  label?: string
  value: string[]
  onChange: (ciudades: string[]) => void
  error?: string
}) {
  const listaId = useId()
  const [texto, setTexto] = useState("")
  // Resultado de la última búsqueda terminada; el estado visible se deriva de él y del texto.
  const [resultado, setResultado] = useState<{ q: string; lista: Sugerencia[] | null } | null>(null)
  const [abierta, setAbierta] = useState(false)
  const [activa, setActiva] = useState(-1)

  const q = texto.trim()
  const largo = normalizarBusqueda(q).length >= MIN_CARACTERES
  const vigente = largo && resultado?.q === q ? resultado : null
  const sugerencias = vigente?.lista ?? []
  const estado: Estado = !q ? "inactivo" : !largo ? "corto" : !vigente ? "cargando" : vigente.lista ? "ok" : "error"

  useEffect(() => {
    if (!largo) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/api/admin/envios/localidades?q=${encodeURIComponent(q)}`, { cache: "no-store", signal: ctl.signal })
        .then(async (res) => ({ res, json: (await res.json().catch(() => null)) as { localidades?: Sugerencia[] } | null }))
        .then(({ res, json }) => {
          setResultado({ q, lista: res.ok && json?.localidades ? json.localidades : null })
          setActiva(-1)
        })
        .catch((err) => {
          if (!ctl.signal.aborted && err) setResultado({ q, lista: null })
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [q, largo])

  const yaEsta = (nombre: string) => value.some((c) => normalizarBusqueda(c) === normalizarBusqueda(nombre))

  const agregar = (s: Sugerencia) => {
    if (!yaEsta(s.nombre)) onChange([...value, s.nombre])
    setTexto("")
    setActiva(-1)
    setAbierta(false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (sugerencias.length === 0) return
      e.preventDefault()
      setAbierta(true)
      setActiva((i) => (i + 1) % sugerencias.length)
    } else if (e.key === "ArrowUp") {
      if (sugerencias.length === 0) return
      e.preventDefault()
      setAbierta(true)
      setActiva((i) => (i <= 0 ? sugerencias.length - 1 : i - 1))
    } else if (e.key === "Enter") {
      // Nunca enviar el formulario desde el buscador.
      e.preventDefault()
      const s = sugerencias[activa]
      if (abierta && s) agregar(s)
    } else if (e.key === "Escape") {
      setAbierta(false)
      setActiva(-1)
    }
  }

  const mensaje =
    estado === "corto"
      ? "Escriba al menos 4 letras"
      : estado === "cargando"
        ? "Buscando…"
        : estado === "error"
          ? "No pudimos buscar las localidades. Inténtelo nuevamente."
          : estado === "ok" && sugerencias.length === 0
            ? "Sin resultados"
            : null
  const mostrarLista = abierta && estado === "ok" && sugerencias.length > 0
  const mostrarMensaje = abierta && mensaje !== null

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`${label} elegidas`}>
          {value.map((c) => (
            <li key={c}>
              <Chip variant="removable" removeLabel={`Quitar ${c}`} onRemove={() => onChange(value.filter((x) => x !== c))}>
                {c}
              </Chip>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Field label={label} hint="Busque y agregue las localidades. Sin ninguna = toda la zona de la sucursal." error={error}>
          <Input
            role="combobox"
            aria-expanded={mostrarLista}
            aria-controls={listaId}
            aria-autocomplete="list"
            aria-activedescendant={mostrarLista && activa >= 0 ? `${listaId}-${activa}` : undefined}
            aria-invalid={Boolean(error)}
            autoComplete="off"
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value)
              setAbierta(true)
            }}
            onFocus={() => setAbierta(true)}
            onBlur={() => setAbierta(false)}
            onKeyDown={onKeyDown}
          />
        </Field>
        <ul
          id={listaId}
          role="listbox"
          aria-label={`Localidades para ${label}`}
          hidden={!mostrarLista}
          className="absolute left-0 right-0 z-10 mt-1 max-h-60 overflow-auto rounded-lg border border-border bg-elevated p-1 shadow-md"
        >
          {mostrarLista &&
            sugerencias.map((s, i) => (
              <li
                key={s.id}
                id={`${listaId}-${i}`}
                role="option"
                aria-selected={i === activa}
                aria-disabled={yaEsta(s.nombre)}
                // onMouseDown evita que el input pierda foco (y cierre la lista) antes del click.
                onMouseDown={(e) => {
                  e.preventDefault()
                  agregar(s)
                }}
                onMouseEnter={() => setActiva(i)}
                className={`cursor-pointer rounded-md px-2 py-1.5 text-sm${i === activa ? " bg-accent-soft" : ""}`}
              >
                {s.etiqueta}
                {yaEsta(s.nombre) && " (ya agregada)"}
              </li>
            ))}
        </ul>
        {mostrarMensaje && !mostrarLista && (
          <p className="mt-1 text-sm" role={estado === "error" ? "alert" : "status"} style={{ color: estado === "error" ? "var(--red)" : "var(--ink-soft)" }}>
            {mensaje}
          </p>
        )}
      </div>
    </div>
  )
}
