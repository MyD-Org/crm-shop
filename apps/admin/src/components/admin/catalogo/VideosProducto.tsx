"use client"

import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button, Input } from "@myd-org/ui"
import { idYoutubeDeEnlace, MAX_VIDEOS } from "@/lib/video-youtube"
import { api, ErrorApi, type VideoDto } from "./tipos"

/**
 * Videos de YouTube de un producto (hasta 3). Se pega el enlace público, se guarda sólo el id y la
 * tienda compone el reproductor. Igual que las fotos, cada cambio se persiste solo (endpoint propio),
 * sin esperar al «Guardar» del diálogo.
 */

interface Props {
  alegraId: string
  videos: VideoDto[]
  onCambio: (videos: VideoDto[]) => void
  /** "variante" = videos PROPIOS de una variante (se guardan en su overlay; las demás usan los del modelo). */
  alcance?: "variante"
  /** Título de la sección; por defecto «Videos del producto». */
  titulo?: string
}

export function VideosProducto({ alegraId, videos, onCambio, alcance, titulo = "Videos del producto" }: Props) {
  const [enlace, setEnlace] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState("")

  async function persistir(lista: VideoDto[]) {
    const sufijo = alcance === "variante" ? "?alcance=variante" : ""
    const { producto } = await api<{ producto: { videos: VideoDto[] } }>(
      `/api/admin/catalogo/productos/${encodeURIComponent(alegraId)}/videos${sufijo}`,
      { method: "PUT", body: JSON.stringify({ videos: lista.map((v) => ({ id: v.id })) }) },
    )
    onCambio(producto.videos)
  }

  async function guardar(lista: VideoDto[]) {
    setGuardando(true)
    setError("")
    try {
      await persistir(lista)
      return true
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos guardar el cambio.")
      return false
    } finally {
      setGuardando(false)
    }
  }

  async function agregar() {
    setError("")
    const id = idYoutubeDeEnlace(enlace)
    if (!id) return setError("Ingrese un enlace de YouTube.")
    if (videos.some((v) => v.id === id)) return setError("Ese video ya está cargado.")
    if (videos.length >= MAX_VIDEOS) return setError(`Se admiten hasta ${MAX_VIDEOS} videos por producto.`)
    if (await guardar([...videos, { id }])) setEnlace("")
  }

  return (
    <section className="flex flex-col gap-2">
      <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
        {titulo}
      </span>

      <div className="flex items-center gap-2">
        <Input
          aria-label="Enlace de YouTube"
          placeholder="https://www.youtube.com/watch?v=…"
          value={enlace}
          disabled={guardando}
          onChange={(e) => setEnlace(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void agregar()
            }
          }}
        />
        <Button variant="ghost" size="sm" disabled={guardando || enlace.trim() === ""} onClick={() => void agregar()}>
          <Plus size={13} />
          Agregar
        </Button>
      </div>

      {videos.length === 0 ? (
        <p
          className="rounded-[var(--radius)] p-3 text-xs"
          style={{ background: "var(--bg)", border: "1px dashed var(--border-strong)", color: "var(--ink-soft)" }}
        >
          {alcance === "variante"
            ? "Esta variante no tiene videos propios: la tienda muestra los del modelo."
            : "Este producto no tiene videos. Los videos se muestran en la ficha, después de las fotos."}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {videos.map((v) => (
            <li
              key={v.id}
              className="relative overflow-hidden rounded-[var(--radius)]"
              style={{ border: "1px solid var(--border)", width: 116 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- el host es i.ytimg.com, fuera de los dominios de next/image */}
              <img
                src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`}
                alt={`Miniatura del video ${v.id}`}
                width={116}
                height={65}
                style={{ width: 116, height: 65, objectFit: "cover", display: "block" }}
              />
              <div className="flex items-center justify-end p-1">
                <Button variant="ghost" size="sm" title="Quitar" disabled={guardando} onClick={() => void guardar(videos.filter((x) => x.id !== v.id))}>
                  <Trash2 size={12} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-xs" role="alert" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
      <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
        Pegue el enlace de un video de YouTube. Se admiten hasta {MAX_VIDEOS} videos por producto.
      </p>
    </section>
  )
}
