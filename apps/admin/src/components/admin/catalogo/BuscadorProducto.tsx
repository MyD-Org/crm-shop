"use client"

import { useEffect, useState } from "react"
import { Button, SearchInput } from "@myd-org/ui"
import type { FilaGrilla } from "@/lib/precios-online-grilla"
import { api } from "./tipos"

export interface ProductoElegido {
  alegraId: string
  nombre: string
  code: string | null
}

interface Props {
  elegido: ProductoElegido | null
  onElegir: (p: ProductoElegido | null) => void
}

const MAX_RESULTADOS = 8

/**
 * Buscador de un producto del catálogo para el ajuste por producto: se elige de los resultados
 * (nunca texto libre). Usa la grilla de precios online, que ya busca por código y nombre.
 */
export function BuscadorProducto({ elegido, onElegir }: Props) {
  const [q, setQ] = useState("")
  const [resultados, setResultados] = useState<ProductoElegido[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const texto = q.trim()
    if (texto.length < 2) return
    let vigente = true
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ q: texto, limit: String(MAX_RESULTADOS) })
        const r = await api<{ items: FilaGrilla[] }>(`/api/admin/catalogo/precios-online?${p}`)
        if (!vigente) return
        setResultados(r.items.map((f) => ({ alegraId: f.alegraId, nombre: f.nombre, code: f.code })))
        setError(false)
      } catch {
        if (vigente) setError(true)
      }
    }, 250)
    return () => {
      vigente = false
      clearTimeout(t)
    }
  }, [q])

  if (elegido) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="flex-1 min-w-0 truncate">
          {elegido.nombre}
          {elegido.code ? <span style={{ color: "var(--ink-faint)" }}> · {elegido.code}</span> : null}
        </span>
        <Button size="sm" variant="ghost" onClick={() => onElegir(null)}>
          Cambiar
        </Button>
      </div>
    )
  }

  const mostrar = q.trim().length >= 2 ? resultados : null
  return (
    <div className="flex flex-col gap-2">
      <SearchInput
        value={q}
        onValueChange={(v) => {
          setQ(v)
          if (v.trim().length < 2) setResultados(null)
        }}
        onClear={() => {
          setQ("")
          setResultados(null)
        }}
        clearLabel="Borrar búsqueda"
        placeholder="Buscar por nombre o código"
        aria-label="Buscar producto"
      />
      {error && <p className="text-sm text-danger">No se pudo buscar. Inténtelo de nuevo.</p>}
      {mostrar && mostrar.length === 0 && (
        <p className="text-sm" style={{ color: "var(--ink-faint)" }}>Ningún producto coincide con la búsqueda.</p>
      )}
      {mostrar && mostrar.length > 0 && (
        <ul className="flex flex-col max-h-60 overflow-y-auto">
          {mostrar.map((p) => (
            <li key={p.alegraId}>
              <button
                type="button"
                className="w-full text-left text-sm px-2 py-1.5 rounded-md hover:bg-subtle"
                onClick={() => onElegir(p)}
              >
                {p.nombre}
                {p.code ? <span style={{ color: "var(--ink-faint)" }}> · {p.code}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
