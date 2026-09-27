"use client"

import { useRef, useState } from "react"
import { FileText, Loader2, Trash2, Upload } from "lucide-react"
import { Button } from "@myd-org/ui"
import { api, ErrorApi, formatBytes, type FichaDto } from "./tipos"

/**
 * Ficha técnica (PDF) de un producto.
 *
 * Mismo patrón que FotosProducto: el archivo NO pasa por el servidor. Se pide acá una URL PUT
 * firmada y se sube directo a R2; el servidor sólo firma y, al final, persiste la key.
 */

interface Props {
  alegraId: string
  ficha: FichaDto | null
  onCambio: (ficha: FichaDto | null) => void
}

const MAX_BYTES = 10 * 1024 * 1024
const MAX_MB = MAX_BYTES / 1024 / 1024

export function FichaTecnicaProducto({ alegraId, ficha, onCambio }: Props) {
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  async function subir(files: FileList | null) {
    const file = files?.[0]
    if (!file) return

    setError("")
    if (file.type !== "application/pdf") {
      setError("La ficha técnica tiene que ser un archivo PDF.")
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`El archivo no puede superar los ${MAX_MB} MB.`)
      return
    }

    setSubiendo(true)
    try {
      const { key, url, headers } = await api<{ key: string; url: string; headers: { "content-type": string } }>(
        `/api/admin/catalogo/productos/${encodeURIComponent(alegraId)}/ficha`,
        { method: "POST", body: JSON.stringify({ nombre: file.name, bytes: file.size }) },
      )

      // Los headers son los MISMOS que se firmaron: si no coinciden, R2 responde 403.
      const res = await fetch(url, { method: "PUT", headers, body: file })
      if (!res.ok) throw new Error(`La subida falló (${res.status}).`)

      const { producto } = await api<{ producto: { fichaTecnica: FichaDto } }>(
        `/api/admin/catalogo/productos/${encodeURIComponent(alegraId)}/ficha`,
        { method: "PUT", body: JSON.stringify({ key, nombre: file.name, bytes: file.size }) },
      )
      onCambio(producto.fichaTecnica)
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos subir el archivo.")
    } finally {
      setSubiendo(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function quitar() {
    setError("")
    try {
      await api(`/api/admin/catalogo/productos/${encodeURIComponent(alegraId)}/ficha`, { method: "DELETE" })
      onCambio(null)
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos quitar la ficha técnica.")
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          Ficha técnica (PDF)
        </span>
        <Button variant="ghost" size="sm" disabled={subiendo} onClick={() => inputRef.current?.click()}>
          {subiendo ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {subiendo ? "Subiendo…" : ficha ? "Reemplazar" : "Subir PDF"}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => void subir(e.target.files)}
      />

      {ficha ? (
        <div
          className="flex items-center justify-between gap-2 rounded-[var(--radius)] p-2 text-sm"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        >
          <a
            href={ficha.url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-2 underline"
            style={{ color: "var(--ink)" }}
          >
            <FileText size={14} className="shrink-0" />
            <span className="truncate" title={ficha.nombre}>
              {ficha.nombre}
            </span>
          </a>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
              {formatBytes(ficha.bytes)}
            </span>
            <Button variant="ghost" size="sm" title="Quitar" onClick={() => void quitar()}>
              <Trash2 size={12} />
            </Button>
          </div>
        </div>
      ) : (
        <p
          className="rounded-[var(--radius)] p-3 text-xs"
          style={{ background: "var(--bg)", border: "1px dashed var(--border-strong)", color: "var(--ink-soft)" }}
        >
          Este producto no tiene ficha técnica. Puede publicarlo igual: no es condición para que la tienda lo muestre.
        </p>
      )}

      {error && (
        <p className="text-xs" role="alert" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
      <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
        Acepta un archivo PDF de hasta {MAX_MB} MB.
      </p>
    </section>
  )
}
