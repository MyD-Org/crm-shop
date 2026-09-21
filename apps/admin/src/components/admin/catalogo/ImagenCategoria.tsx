"use client"

import { useRef, useState } from "react"
import { ImagePlus, Loader2, Trash2 } from "lucide-react"
import { Button } from "@myd-org/ui"
import { api, ErrorApi } from "./tipos"
import { generarVariantes, ImagenInvalida, TIPOS_ACEPTADOS } from "./redimensionar"

/**
 * Foto de portada de una categoría: es la que la tienda usa en las tarjetas del menú y de la home.
 *
 * Una sola imagen y un solo tamaño, a diferencia de las fotos de producto: acá es una portada, no
 * una galería. Igual que allá, el archivo no pasa por el servidor y se guarda la key, no la url.
 */

interface Props {
  /** Key ya guardada, o null. */
  imagenKey: string | null
  /** Url compuesta por el servidor para previsualizar, o null si todavía no se guardó. */
  url: string | null
  onCambio: (imagenKey: string | null) => void
}

/** Ancho de la portada. Coincide con el que firma el endpoint. */
const ANCHO_PORTADA = 800

export function ImagenCategoria({ imagenKey, url, onCambio }: Props) {
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState("")
  const [previa, setPrevia] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function subir(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setSubiendo(true)
    setError("")
    try {
      const variantes = await generarVariantes(file)
      const elegida = variantes.find((v) => v.ancho === ANCHO_PORTADA) ?? variantes[variantes.length - 1]

      const firmada = await api<{ key: string; url: string; headers: { "content-type": string } }>(
        "/api/admin/catalogo/categorias/imagen",
        { method: "POST", body: JSON.stringify({ bytes: elegida.blob.size }) },
      )

      const res = await fetch(firmada.url, { method: "PUT", headers: firmada.headers, body: elegida.blob })
      if (!res.ok) throw new Error(`La subida falló (${res.status}).`)

      // La previa sale del blob local: la key recién se persiste cuando se guarda la categoría, y
      // hasta entonces el servidor no puede componer su url.
      setPrevia(URL.createObjectURL(elegida.blob))
      onCambio(firmada.key)
    } catch (err) {
      if (err instanceof ImagenInvalida) setError(err.message)
      else if (err instanceof ErrorApi) setError(err.message)
      else setError(err instanceof Error ? err.message : "No pudimos subir la imagen.")
    } finally {
      setSubiendo(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const aMostrar = previa ?? url

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {aMostrar ? (
          // eslint-disable-next-line @next/next/no-img-element -- el host es R2, fuera de los dominios de next/image
          <img
            src={aMostrar}
            alt=""
            width={96}
            height={64}
            style={{ width: 96, height: 64, objectFit: "cover", borderRadius: "var(--radius)" }}
          />
        ) : (
          <div
            className="flex items-center justify-center"
            style={{
              width: 96,
              height: 64,
              borderRadius: "var(--radius)",
              border: "1px dashed var(--border-strong)",
              color: "var(--ink-faint)",
            }}
          >
            <ImagePlus size={16} />
          </div>
        )}

        <div className="flex gap-1">
          <Button variant="ghost" size="sm" disabled={subiendo} onClick={() => inputRef.current?.click()}>
            {subiendo ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
            {aMostrar ? "Cambiar" : "Subir imagen"}
          </Button>
          {(imagenKey || previa) && (
            <Button
              variant="ghost"
              size="sm"
              disabled={subiendo}
              onClick={() => {
                setPrevia(null)
                onCambio(null)
              }}
            >
              <Trash2 size={13} /> Quitar
            </Button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={TIPOS_ACEPTADOS.join(",")}
        className="hidden"
        onChange={(e) => void subir(e.target.files)}
      />

      {error && (
        <p className="text-xs" role="alert" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
    </div>
  )
}
