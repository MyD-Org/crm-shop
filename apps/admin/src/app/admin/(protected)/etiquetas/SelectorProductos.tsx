"use client"

import { useEffect, useState } from "react"
import { Alert, Button, Field, SearchInput, Select } from "@myd-org/ui"
import { api } from "@/components/admin/catalogo/tipos"
import { filasDeProducto, MAX_PRODUCTOS_LISTA, MENSAJE_TOPE_MARCA, type FilaLista, type ProductoListado } from "@/lib/etiquetas/lista"

const MAX_RESULTADOS = 10
/** Página del listado al traer una marca entera (LIMITE_LISTADO_MAX del servidor). */
const PAGINA_MARCA = 200
const TODAS = "__todas"

interface Props {
  marcas: { clave: string; nombre: string }[]
  /** Suma filas a la lista (sin duplicar) y devuelve cuántas entraron. */
  onAgregar: (filas: FilaLista[]) => number
}

interface Pagina {
  items: ProductoListado[]
  total: number
}

const listar = (params: Record<string, string>) =>
  api<Pagina>(`/api/admin/catalogo/productos?${new URLSearchParams({ alegra: "active", ...params })}`)

export function SelectorProductos({ marcas, onAgregar }: Props) {
  const [q, setQ] = useState("")
  const [marca, setMarca] = useState(TODAS)
  const [resultados, setResultados] = useState<ProductoListado[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [cargandoMarca, setCargandoMarca] = useState(false)

  const conMarca = marca !== TODAS
  const buscar = q.trim().length >= 2 || conMarca

  useEffect(() => {
    if (!buscar) return
    let vigente = true
    const t = setTimeout(async () => {
      try {
        const p: Record<string, string> = { limit: String(MAX_RESULTADOS) }
        if (q.trim()) p.q = q.trim()
        if (conMarca) p.marca = marca
        const r = await listar(p)
        if (!vigente) return
        setResultados(r.items)
        setError(null)
      } catch (e) {
        if (vigente) setError(e instanceof Error ? e.message : "No se pudo buscar. Inténtelo nuevamente.")
      }
    }, 250)
    return () => {
      vigente = false
      clearTimeout(t)
    }
  }, [q, marca, conMarca, buscar])

  const agregar = (filas: FilaLista[]) => {
    const n = onAgregar(filas)
    setAviso(n === 0 ? "Ya estaba en la lista." : n === 1 ? "Se agregó 1 producto a la lista." : `Se agregaron ${n} productos a la lista.`)
  }

  const agregarMarca = async () => {
    setCargandoMarca(true)
    setError(null)
    setAviso(null)
    try {
      const productos: ProductoListado[] = []
      let total = 0
      for (let start = 0; start < MAX_PRODUCTOS_LISTA; start += PAGINA_MARCA) {
        const r = await listar({ marca, start: String(start), limit: String(Math.min(PAGINA_MARCA, MAX_PRODUCTOS_LISTA - start)) })
        productos.push(...r.items)
        total = r.total
        if (start + PAGINA_MARCA >= r.total) break
      }
      const n = onAgregar(productos.flatMap(filasDeProducto))
      const base = n === 1 ? "Se agregó 1 producto de la marca." : `Se agregaron ${n} productos de la marca.`
      setAviso(total > MAX_PRODUCTOS_LISTA ? MENSAJE_TOPE_MARCA : base)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron traer los productos de la marca. Inténtelo nuevamente.")
    } finally {
      setCargandoMarca(false)
    }
  }

  const mostrar = buscar ? resultados : null
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Buscar">
          <SearchInput
            value={q}
            onValueChange={(v) => {
              setQ(v)
              setAviso(null)
            }}
            onClear={() => setQ("")}
            clearLabel="Borrar búsqueda"
            placeholder="Nombre o código"
            aria-label="Buscar producto por nombre o código"
          />
        </Field>
        <Field label="Marca">
          <Select
            aria-label="Filtrar por marca"
            value={marca}
            onValueChange={(v) => {
              setMarca(v)
              setAviso(null)
              if (v === TODAS && q.trim().length < 2) setResultados(null)
            }}
            options={[{ value: TODAS, label: "Todas las marcas" }, ...marcas.map((m) => ({ value: m.clave, label: m.nombre }))]}
          />
        </Field>
      </div>

      {conMarca && (
        <div>
          <Button variant="secondary" size="sm" onClick={() => void agregarMarca()} loading={cargandoMarca} disabled={cargandoMarca}>
            Agregar todos los de la marca
          </Button>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
      {aviso && <p className="text-sm" role="status" style={{ color: "var(--ink-soft)" }}>{aviso}</p>}

      {mostrar && mostrar.length === 0 && (
        <p className="text-sm" style={{ color: "var(--ink-faint)" }}>Ningún producto coincide con la búsqueda.</p>
      )}
      {mostrar && mostrar.length > 0 && (
        <ul className="flex flex-col divide-y divide-border max-h-72 overflow-y-auto">
          {mostrar.map((p) => (
            <li key={p.alegraId} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="flex-1 min-w-0">
                <span className="block truncate">{p.nombreEfectivo}</span>
                <span className="block text-xs" style={{ color: "var(--ink-faint)" }}>
                  {p.variantes && p.variantes.length > 0
                    ? `${p.variantes.length} variantes`
                    : p.code ?? "Sin referencia"}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => agregar(filasDeProducto(p))}>
                Agregar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
