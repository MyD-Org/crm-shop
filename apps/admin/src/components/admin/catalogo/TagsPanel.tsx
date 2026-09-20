"use client"

import { useState } from "react"
import { Check, Pencil, Tags, Trash2, X } from "lucide-react"
import { Button, Dialog, EmptyState, Input } from "@myd-org/ui"
import { api, ErrorApi, type TagDto } from "./tipos"

interface Props {
  tags: TagDto[]
  onCambio: () => Promise<void> | void
}

/**
 * ABM de etiquetas. Son planas (no tienen jerarquía ni orden) y su identificador no cambia al
 * renombrarlas: por eso renombrar impacta a todos sus productos de una sola vez, sin tocar
 * ninguno.
 */
export function TagsPanel({ tags, onCambio }: Props) {
  const [nueva, setNueva] = useState("")
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null)
  const [borrando, setBorrando] = useState<{ tag: TagDto; productos: number } | null>(null)
  const [error, setError] = useState("")
  const [ocupado, setOcupado] = useState(false)

  async function crear() {
    const nombre = nueva.trim()
    if (!nombre) return
    setOcupado(true)
    setError("")
    try {
      await api("/api/admin/catalogo/tags", { method: "POST", body: JSON.stringify({ nombre }) })
      setNueva("")
      await onCambio()
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos crear la etiqueta.")
    } finally {
      setOcupado(false)
    }
  }

  async function renombrar() {
    if (!editando) return
    setOcupado(true)
    setError("")
    try {
      await api(`/api/admin/catalogo/tags/${editando.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nombre: editando.nombre }),
      })
      setEditando(null)
      await onCambio()
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos renombrar la etiqueta.")
    } finally {
      setOcupado(false)
    }
  }

  async function pedirBorrar(tag: TagDto) {
    setError("")
    try {
      const { impacto } = await api<{ impacto: { productos: number } }>(`/api/admin/catalogo/tags/${tag.id}`)
      setBorrando({ tag, productos: impacto.productos })
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos consultar la etiqueta.")
    }
  }

  async function borrar() {
    if (!borrando) return
    setOcupado(true)
    try {
      await api(`/api/admin/catalogo/tags/${borrando.tag.id}`, { method: "DELETE" })
      setBorrando(null)
      await onCambio()
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos eliminar la etiqueta.")
      setBorrando(null)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
        Las etiquetas cruzan la categoría: un producto puede tener las que necesite. Al renombrar una, el cambio alcanza
        a todos sus productos de inmediato.
      </p>

      <div className="flex gap-2">
        <Input
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          placeholder="Nombre de la etiqueta nueva"
          aria-label="Nombre de la etiqueta nueva"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void crear()
            }
          }}
        />
        <Button onClick={() => void crear()} disabled={ocupado || nueva.trim() === ""}>
          Crear
        </Button>
      </div>

      {error && (
        <p className="rounded-[var(--radius)] p-3 text-sm" style={{ background: "var(--red-soft)", color: "var(--red)" }} role="alert">
          {error}
        </p>
      )}

      {tags.length === 0 ? (
        <EmptyState
          icon={<Tags size={28} strokeWidth={1.2} />}
          title="Todavía no hay etiquetas"
          description="Cree la primera para marcar productos en oferta, novedades o lo que necesite."
        />
      ) : (
        <ul className="flex flex-col divide-y" style={{ borderColor: "var(--border)" }}>
          {tags.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-2">
              {editando?.id === t.id ? (
                <>
                  <Input
                    value={editando.nombre}
                    onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                    aria-label={`Nuevo nombre de ${t.nombre}`}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void renombrar()
                      }
                      if (e.key === "Escape") setEditando(null)
                    }}
                  />
                  <Button variant="ghost" size="sm" aria-label="Guardar" onClick={() => void renombrar()} disabled={ocupado}>
                    <Check size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Cancelar" onClick={() => setEditando(null)}>
                    <X size={14} />
                  </Button>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" style={{ color: "var(--ink)" }}>
                      {t.nombre}
                    </div>
                    <div className="text-xs" style={{ color: "var(--ink-faint)" }}>
                      /{t.slug} · {t.productos} producto{t.productos === 1 ? "" : "s"}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Renombrar ${t.nombre}`}
                    onClick={() => setEditando({ id: t.id, nombre: t.nombre })}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Eliminar ${t.nombre}`} onClick={() => void pedirBorrar(t)}>
                    <Trash2 size={14} />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {borrando && (
        <Dialog
          open
          size="sm"
          onOpenChange={(abierto) => {
            if (!abierto) setBorrando(null)
          }}
          title={`Eliminar "${borrando.tag.nombre}"`}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setBorrando(null)} disabled={ocupado}>
                Cancelar
              </Button>
              <Button onClick={() => void borrar()} disabled={ocupado}>
                Eliminar
              </Button>
            </div>
          }
        >
          <p className="text-sm" style={{ color: "var(--ink)" }}>
            {borrando.productos === 0
              ? "Ningún producto tiene esta etiqueta."
              : `${borrando.productos} producto${borrando.productos === 1 ? "" : "s"} perderá${borrando.productos === 1 ? "" : "n"} esta etiqueta.`}
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--ink-faint)" }}>
            Los productos no se eliminan ni se ocultan, y conservan el resto de sus etiquetas.
          </p>
        </Dialog>
      )}
    </div>
  )
}
