"use client"

import { useEffect, useState } from "react"
import { Button, Checkbox, SearchInput } from "@myd-org/ui"
import { MAX_CAMBIOS } from "@/lib/precios-online-cambios"
import type { FilaGrilla } from "@/lib/precios-online-grilla"
import { api } from "./tipos"

export interface ProductoElegido {
  alegraId: string
  nombre: string
  code: string | null
}

interface Props {
  elegidos: ProductoElegido[]
  onCambiar: (p: ProductoElegido[]) => void
}

const MAX_RESULTADOS = 8
/** Cada producto es un cambio en la misma vista previa: el servidor acepta hasta MAX_CAMBIOS. */
export const MAX_PRODUCTOS = MAX_CAMBIOS

/**
 * Buscador de productos del catálogo para el ajuste por producto: se eligen de los resultados
 * (nunca texto libre) y se pueden sumar varios, de distintas búsquedas, al mismo ajuste. Usa la
 * grilla de precios online, que ya busca por código y nombre.
 */
export function BuscadorProducto({ elegidos, onCambiar }: Props) {
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

  const elegido = (id: string) => elegidos.some((e) => e.alegraId === id)
  const lleno = elegidos.length >= MAX_PRODUCTOS
  const alternar = (p: ProductoElegido) =>
    onCambiar(elegido(p.alegraId) ? elegidos.filter((e) => e.alegraId !== p.alegraId) : lleno ? elegidos : [...elegidos, p])

  const mostrar = q.trim().length >= 2 ? resultados : null
  return (
    <div className="flex flex-col gap-2">
      {elegidos.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-sm" style={{ color: "var(--ink-soft)" }}>
            <span>
              {elegidos.length === 1 ? "1 producto seleccionado" : `${elegidos.length} productos seleccionados`}
            </span>
            <Button size="sm" variant="ghost" onClick={() => onCambiar([])}>
              Quitar todos
            </Button>
          </div>
          <ul className="flex flex-col max-h-40 overflow-y-auto">
            {elegidos.map((p) => (
              <li key={p.alegraId} className="flex items-center gap-2 text-sm">
                <span className="flex-1 min-w-0 truncate">
                  {p.nombre}
                  {p.code ? <span style={{ color: "var(--ink-faint)" }}> · {p.code}</span> : null}
                </span>
                <Button size="sm" variant="ghost" onClick={() => alternar(p)}>
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
      {lleno && (
        <p className="text-sm" style={{ color: "var(--ink-faint)" }}>
          Se alcanzó el máximo de {MAX_PRODUCTOS} productos por ajuste.
        </p>
      )}
      {error && <p className="text-sm text-danger">No se pudo buscar. Inténtelo de nuevo.</p>}
      {mostrar && mostrar.length === 0 && (
        <p className="text-sm" style={{ color: "var(--ink-faint)" }}>Ningún producto coincide con la búsqueda.</p>
      )}
      {mostrar && mostrar.length > 0 && (
        <ul className="flex flex-col max-h-60 overflow-y-auto">
          {mostrar.map((p) => (
            <li key={p.alegraId}>
              <label className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-md hover:bg-subtle cursor-pointer">
                <Checkbox
                  checked={elegido(p.alegraId)}
                  disabled={lleno && !elegido(p.alegraId)}
                  onCheckedChange={() => alternar(p)}
                />
                <span className="min-w-0">
                  {p.nombre}
                  {p.code ? <span style={{ color: "var(--ink-faint)" }}> · {p.code}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
