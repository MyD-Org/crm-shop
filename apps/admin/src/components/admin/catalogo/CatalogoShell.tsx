"use client"

import { useCallback, useState } from "react"
import { Tabs } from "@myd-org/ui"
import { CategoriasPanel } from "./CategoriasPanel"
import { ProductosPanel } from "./ProductosPanel"
import { TagsPanel } from "./TagsPanel"
import { api, type CategoriaDto, type TagDto } from "./tipos"

interface Props {
  initialCategorias: CategoriaDto[]
  initialTags: TagDto[]
}

type Tab = "productos" | "categorias" | "etiquetas"

/**
 * Panel de catálogo: la sección donde se cura lo que la tienda muestra. Vive en la navegación
 * principal y no dentro de Configuración porque es trabajo diario sobre miles de productos, no
 * un ajuste que se toca una vez.
 *
 * Categorías y etiquetas se cargan una sola vez acá y se comparten con las tres solapas: el
 * listado de productos las necesita para sus filtros y para las acciones masivas, y la ficha
 * para sus selectores.
 */
export function CatalogoShell({ initialCategorias, initialTags }: Props) {
  const [tab, setTab] = useState<Tab>("productos")
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
          { value: "categorias", label: "Categorías" },
          { value: "etiquetas", label: "Etiquetas" },
        ]}
      />

      {tab === "productos" && (
        <ProductosPanel
          categorias={categorias}
          tags={tags}
          onTagCreado={(tag) => setTags((prev) => [...prev, tag].sort((a, b) => a.nombre.localeCompare(b.nombre)))}
          onCambio={() => void recargarTaxonomia()}
        />
      )}
      {tab === "categorias" && <CategoriasPanel categorias={categorias} onCambio={recargarTaxonomia} />}
      {tab === "etiquetas" && <TagsPanel tags={tags} onCambio={recargarTaxonomia} />}
    </div>
  )
}
