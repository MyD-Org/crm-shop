"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp, FolderTree, Pencil, Trash2 } from "lucide-react"
import { Button, Dialog, EmptyState, Field, Input, Select } from "@myd-org/ui"
import { ImagenCategoria } from "./ImagenCategoria"
import { api, ErrorApi, type CategoriaDto } from "./tipos"

interface Props {
  categorias: CategoriaDto[]
  onCambio: () => Promise<void> | void
}

interface Edicion {
  id: string | null
  nombre: string
  parentId: string
  imagenKey: string | null
  imagenUrl: string | null
}

/** Las categorías en orden de árbol (una rama completa antes de la siguiente), con su profundidad. */
function enOrdenDeArbol(categorias: CategoriaDto[]): { cat: CategoriaDto; hermanas: CategoriaDto[] }[] {
  const hijas = (parentId: string | null) =>
    categorias.filter((c) => c.parentId === parentId).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
  const salida: { cat: CategoriaDto; hermanas: CategoriaDto[] }[] = []
  const recorrer = (parentId: string | null) => {
    const grupo = hijas(parentId)
    for (const cat of grupo) {
      salida.push({ cat, hermanas: grupo })
      recorrer(cat.id)
    }
  }
  recorrer(null)
  return salida
}

/** Radix reserva el string vacío en Select: con `""` la opción no se muestra. */
const SIN_PADRE = "sin-padre"

export function CategoriasPanel({ categorias, onCambio }: Props) {
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [importacion, setImportacion] = useState("")
  const [borrando, setBorrando] = useState<{ cat: CategoriaDto; productos: number; hijas: number } | null>(null)
  const [error, setError] = useState("")
  const [ocupado, setOcupado] = useState(false)

  const filas = enOrdenDeArbol(categorias)

  async function guardar() {
    if (!edicion) return
    setOcupado(true)
    setError("")
    try {
      const cuerpo = JSON.stringify({
        nombre: edicion.nombre,
        parentId: edicion.parentId === SIN_PADRE ? null : edicion.parentId,
        imagenKey: edicion.imagenKey,
      })
      if (edicion.id) {
        await api(`/api/admin/catalogo/categorias/${edicion.id}`, { method: "PATCH", body: cuerpo })
      } else {
        await api("/api/admin/catalogo/categorias", { method: "POST", body: cuerpo })
      }
      setEdicion(null)
      await onCambio()
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos guardar la categoría. Inténtelo nuevamente.")
    } finally {
      setOcupado(false)
    }
  }

  /** El impacto lo calcula el servidor y se muestra ANTES de confirmar, nunca después. */
  async function pedirBorrar(cat: CategoriaDto) {
    setError("")
    try {
      const { impacto } = await api<{ impacto: { productos: number; hijas: number } }>(
        `/api/admin/catalogo/categorias/${cat.id}`,
      )
      setBorrando({ cat, ...impacto })
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos consultar la categoría.")
    }
  }

  async function borrar() {
    if (!borrando) return
    setOcupado(true)
    try {
      await api(`/api/admin/catalogo/categorias/${borrando.cat.id}`, { method: "DELETE" })
      setBorrando(null)
      await onCambio()
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos eliminar la categoría.")
      setBorrando(null)
    } finally {
      setOcupado(false)
    }
  }

  /**
   * Mover una posición es UNA sola llamada con el nivel completo: el servidor exige el conjunto
   * exacto de hermanas, así que un orden viejo se rechaza entero en vez de quedar a medias.
   */
  async function mover(cat: CategoriaDto, hermanas: CategoriaDto[], delta: -1 | 1) {
    const ids = hermanas.map((h) => h.id)
    const i = ids.indexOf(cat.id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setOcupado(true)
    setError("")
    try {
      await api("/api/admin/catalogo/categorias/orden", {
        method: "PATCH",
        body: JSON.stringify({ parentId: cat.parentId, ids }),
      })
      await onCambio()
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos cambiar el orden.")
    } finally {
      setOcupado(false)
    }
  }

  /**
   * Trae las categorías de Alegra como categorías propias de nivel 1 y clasifica con ellas a los
   * productos que las tengan. Es el atajo para no arrancar de un árbol vacío; después se subdivide
   * a mano. Se puede correr de nuevo sin duplicar nada ni pisar clasificaciones hechas a mano.
   */
  async function importar() {
    setOcupado(true)
    setError("")
    setImportacion("")
    try {
      const r = await api<{ creadas: number; existentes: number; clasificados: number }>(
        "/api/admin/catalogo/categorias/importar",
        { method: "POST" },
      )
      setImportacion(
        r.creadas === 0 && r.existentes > 0
          ? "Las categorías de Alegra ya estaban importadas. No se creó ninguna nueva."
          : `Se crearon ${r.creadas} categorías y se clasificaron ${r.clasificados} productos.`,
      )
      await onCambio()
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos importar las categorías de Alegra.")
    } finally {
      setOcupado(false)
    }
  }

  const opcionesPadre = (excluir?: string) => [
    { value: SIN_PADRE, label: "Sin categoría padre (nivel 1)" },
    ...categorias
      // Una categoría no puede colgar de sí misma, y el tope de la jerarquía es de 3 niveles: una
      // de nivel 3 no puede ser madre de nadie. El servidor lo vuelve a validar igual.
      .filter((c) => c.id !== excluir && c.nivel < 3)
      .map((c) => ({ value: c.id, label: `${"— ".repeat(c.nivel - 1)}${c.nombre}` })),
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Las categorías ordenan la tienda. Admiten hasta tres niveles. Los productos sin categoría quedan en
          &quot;Sin clasificar&quot;, que no es una categoría y no se administra desde acá.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" onClick={() => void importar()} disabled={ocupado}>
            Importar de Alegra
          </Button>
          <Button
            onClick={() => setEdicion({ id: null, nombre: "", parentId: SIN_PADRE, imagenKey: null, imagenUrl: null })}
          >
            Nueva categoría
          </Button>
        </div>
      </div>

      {importacion && (
        <p className="rounded-[var(--radius)] p-2 text-xs" style={{ background: "var(--bg)", color: "var(--ink-soft)" }}>
          {importacion}
        </p>
      )}

      {error && (
        <p className="rounded-[var(--radius)] p-3 text-sm" style={{ background: "var(--red-soft)", color: "var(--red)" }} role="alert">
          {error}
        </p>
      )}

      {filas.length === 0 ? (
        <EmptyState
          icon={<FolderTree size={28} strokeWidth={1.2} />}
          title="Todavía no hay categorías"
          description="Cree la primera para empezar a ordenar el catálogo de la tienda."
        />
      ) : (
        <ul className="flex flex-col divide-y" style={{ borderColor: "var(--border)" }}>
          {filas.map(({ cat, hermanas }) => {
            const i = hermanas.findIndex((h) => h.id === cat.id)
            return (
              <li key={cat.id} className="flex items-center gap-2 py-2" style={{ paddingLeft: `${(cat.nivel - 1) * 20}px` }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" style={{ color: "var(--ink)" }}>
                    {cat.nombre}
                  </div>
                  <div className="text-xs" style={{ color: "var(--ink-faint)" }}>
                    /{cat.slug} · {cat.productos} producto{cat.productos === 1 ? "" : "s"}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Subir ${cat.nombre}`}
                  disabled={ocupado || i === 0}
                  onClick={() => void mover(cat, hermanas, -1)}
                >
                  <ChevronUp size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Bajar ${cat.nombre}`}
                  disabled={ocupado || i === hermanas.length - 1}
                  onClick={() => void mover(cat, hermanas, 1)}
                >
                  <ChevronDown size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Editar ${cat.nombre}`}
                  onClick={() => setEdicion({
                    id: cat.id,
                    nombre: cat.nombre,
                    parentId: cat.parentId ?? SIN_PADRE,
                    imagenKey: cat.imagenKey,
                    imagenUrl: cat.imagenUrl,
                  })}
                >
                  <Pencil size={14} />
                </Button>
                <Button variant="ghost" size="sm" aria-label={`Eliminar ${cat.nombre}`} onClick={() => void pedirBorrar(cat)}>
                  <Trash2 size={14} />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {edicion && (
        <Dialog
          open
          size="sm"
          onOpenChange={(abierto) => {
            if (!abierto) setEdicion(null)
          }}
          title={edicion.id ? "Editar categoría" : "Nueva categoría"}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEdicion(null)} disabled={ocupado}>
                Cancelar
              </Button>
              <Button onClick={() => void guardar()} disabled={ocupado || edicion.nombre.trim() === ""}>
                Guardar
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label="Nombre">
              <Input
                value={edicion.nombre}
                onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })}
                placeholder="Por ejemplo: Iluminación"
                autoFocus
              />
            </Field>
            <Field label="Imagen" hint="La tienda la usa en las tarjetas del menú y de la home.">
              <ImagenCategoria
                imagenKey={edicion.imagenKey}
                url={edicion.imagenUrl}
                onCambio={(imagenKey) => setEdicion({ ...edicion, imagenKey })}
              />
            </Field>
            <Field label="Categoría padre" hint="Deje el primer valor para que sea una categoría principal.">
              <Select
                options={opcionesPadre(edicion.id ?? undefined)}
                value={edicion.parentId}
                onValueChange={(v) => setEdicion({ ...edicion, parentId: v })}
              />
            </Field>
          </div>
        </Dialog>
      )}

      {borrando && (
        <Dialog
          open
          size="sm"
          onOpenChange={(abierto) => {
            if (!abierto) setBorrando(null)
          }}
          title={`Eliminar "${borrando.cat.nombre}"`}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setBorrando(null)} disabled={ocupado}>
                Cancelar
              </Button>
              <Button onClick={() => void borrar()} disabled={ocupado || borrando.hijas > 0}>
                Eliminar
              </Button>
            </div>
          }
        >
          {borrando.hijas > 0 ? (
            <p className="text-sm" style={{ color: "var(--ink)" }}>
              Esta categoría tiene {borrando.hijas} subcategoría{borrando.hijas === 1 ? "" : "s"}. Elimínelas o muévalas
              antes de continuar.
            </p>
          ) : (
            <>
              <p className="text-sm" style={{ color: "var(--ink)" }}>
                {borrando.productos === 0
                  ? "Ningún producto usa esta categoría."
                  : `${borrando.productos} producto${borrando.productos === 1 ? "" : "s"} pasará${borrando.productos === 1 ? "" : "n"} a "Sin clasificar".`}
              </p>
              <p className="mt-2 text-xs" style={{ color: "var(--ink-faint)" }}>
                Los productos no se eliminan ni se ocultan: conservan su nombre, sus etiquetas, sus fotos y su
                visibilidad. Los que estén publicados siguen publicados.
              </p>
            </>
          )}
        </Dialog>
      )}
    </div>
  )
}
