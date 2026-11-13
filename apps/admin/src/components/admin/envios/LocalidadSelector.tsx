"use client"

import { useEffect, useId, useState } from "react"
import { Field, Input } from "@myd-org/ui"
import { normalizarBusqueda } from "@/lib/georef"

// Buscador de localidades de Georef (vía /api/admin/envios/localidades) que devuelve la elegida con
// su ID (a diferencia de `CiudadesEnvioSelector`, que sólo guarda el nombre). Lo usan las entradas
// de respaldo de las zonas, las "localidades que atiende" el método y la prueba de localidad.

export type LocalidadElegida = { id: string; nombre: string; etiqueta: string }
type Estado = "inactivo" | "corto" | "cargando" | "ok" | "error"

const MIN_CARACTERES = 4
const DEBOUNCE_MS = 300

export function LocalidadSelector({
  label,
  hint,
  onSelect,
  excluir = [],
}: {
  label: string
  hint?: string
  onSelect: (l: LocalidadElegida) => void
  /** IDs ya elegidas: se muestran como "ya agregada" y no se pueden volver a elegir. */
  excluir?: string[]
}) {
  const listaId = useId()
  const [texto, setTexto] = useState("")
  const [resultado, setResultado] = useState<{ q: string; lista: LocalidadElegida[] | null } | null>(null)
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
        .then(async (res) => ({ res, json: (await res.json().catch(() => null)) as { localidades?: LocalidadElegida[] } | null }))
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

  const elegir = (s: LocalidadElegida) => {
    if (excluir.includes(s.id)) return
    onSelect(s)
    setTexto("")
    setActiva(-1)
    setAbierta(false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && sugerencias.length > 0) {
      e.preventDefault()
      setAbierta(true)
      setActiva((i) => (i + 1) % sugerencias.length)
    } else if (e.key === "ArrowUp" && sugerencias.length > 0) {
      e.preventDefault()
      setAbierta(true)
      setActiva((i) => (i <= 0 ? sugerencias.length - 1 : i - 1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const s = sugerencias[activa]
      if (abierta && s) elegir(s)
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

  return (
    <div className="relative">
      <Field label={label} hint={hint}>
        <Input
          role="combobox"
          aria-expanded={mostrarLista}
          aria-controls={listaId}
          aria-autocomplete="list"
          aria-activedescendant={mostrarLista && activa >= 0 ? `${listaId}-${activa}` : undefined}
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
        className="absolute left-0 right-0 z-[1000] mt-1 max-h-60 overflow-auto rounded-lg border border-border bg-elevated p-1 shadow-md"
      >
        {mostrarLista &&
          sugerencias.map((s, i) => (
            <li
              key={s.id}
              id={`${listaId}-${i}`}
              role="option"
              aria-selected={i === activa}
              aria-disabled={excluir.includes(s.id)}
              onMouseDown={(e) => {
                e.preventDefault()
                elegir(s)
              }}
              onMouseEnter={() => setActiva(i)}
              className={`cursor-pointer rounded-md px-2 py-1.5 text-sm${i === activa ? " bg-accent-soft" : ""}`}
            >
              {s.etiqueta}
              {excluir.includes(s.id) && " (ya agregada)"}
            </li>
          ))}
      </ul>
      {abierta && mensaje !== null && !mostrarLista && (
        <p className="mt-1 text-sm" role={estado === "error" ? "alert" : "status"} style={{ color: estado === "error" ? "var(--red)" : "var(--ink-soft)" }}>
          {mensaje}
        </p>
      )}
    </div>
  )
}
