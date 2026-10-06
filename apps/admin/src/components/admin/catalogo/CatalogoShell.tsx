"use client"

import { useCallback, useState } from "react"
import { Tabs } from "@myd-org/ui"
import { CategoriasPanel } from "./CategoriasPanel"
import { PreciosOnlinePanel } from "./PreciosOnlinePanel"
import { ProductosPanel } from "./ProductosPanel"
import { RevisionPanel } from "./RevisionPanel"
import { TagsPanel } from "./TagsPanel"
import { api, type CategoriaDto, type CuentaOrigenDto, type SucursalOpcionDto, type TagDto } from "./tipos"

interface Props {
  initialCategorias: CategoriaDto[]
  initialTags: TagDto[]
  /** Cuentas de Alegra del tenant. Con más de una aparecen la columna/filtro de origen y la solapa Revisión. */
  cuentas: CuentaOrigenDto[]
  /** Sucursales del tenant, para "Visible en" y el filtro por sucursal (solo con más de una). */
  sucursales: SucursalOpcionDto[]
}

type Tab = "productos" | "precios" | "categorias" | "etiquetas" | "revision"

/**
 * Panel de catálogo: la sección donde se cura lo que la tienda muestra. Vive en la navegación
 * principal (y no como pestaña de un "Configuración") porque es trabajo diario sobre miles de productos, no
 * un ajuste que se toca una vez.
 *
 * Categorías y etiquetas se cargan una sola vez acá y se comparten con las tres solapas: el
 * listado de productos las necesita para sus filtros y para las acciones masivas, y la ficha
 * para sus selectores.
 */
export function CatalogoShell({ initialCategorias, initialTags, cuentas, sucursales }: Props) {
  const [tab, setTab] = useState<Tab>("productos")
  // Búsqueda que trae "Ver en Productos" de la solapa Revisión; la `key` remonta el panel para aplicarla.
  const [busquedaInicial, setBusquedaInicial] = useState<{ q: string; n: number }>({ q: "", n: 0 })
  const hayVariasCuentas = cuentas.length > 1
  const [categorias, setCategorias] = useState(initialCategorias)
  const [tags, setTags] = useState(initialTags)

  const recargarTaxonomia = useCallback(async () => {
    const [cats, tgs] = await Promise.all([
      api<{ categorias: CategoriaDto[] }>("/api/admin/catalogo/categorias").catch(() => null),
      api<{ tags: TagDto[] }>("/api/admin/catalogo/tags").catch(() => null),
    ])
    if (cats) setCategorias(cats.categorias)
    if (tgs) setTags(tgs.tags)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        variant="underline"
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        items={[
          { value: "productos", label: "Productos" },
          { value: "precios", label: "Precios online" },
          { value: "categorias", label: "Categorías" },
          { value: "etiquetas", label: "Etiquetas" },
          ...(hayVariasCuentas ? [{ value: "revision", label: "Revisión" }] : []),
        ]}
      />

      {tab === "productos" && (
        <ProductosPanel
          key={busquedaInicial.n}
          categorias={categorias}
          tags={tags}
          cuentas={cuentas}
          sucursales={sucursales}
          busquedaInicial={busquedaInicial.q}
          onTagCreado={(tag) => setTags((prev) => [...prev, tag].sort((a, b) => a.nombre.localeCompare(b.nombre)))}
          onCambio={() => void recargarTaxonomia()}
        />
      )}
      {tab === "precios" && <PreciosOnlinePanel categorias={categorias} />}
      {tab === "categorias" && <CategoriasPanel categorias={categorias} onCambio={recargarTaxonomia} />}
      {tab === "etiquetas" && <TagsPanel tags={tags} onCambio={recargarTaxonomia} />}
      {tab === "revision" && hayVariasCuentas && (
        <RevisionPanel
          onVerProducto={(q) => {
            setBusquedaInicial((prev) => ({ q, n: prev.n + 1 }))
            setTab("productos")
          }}
        />
      )}
    </div>
  )
}
