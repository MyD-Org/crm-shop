"use client"

import { useRef, useState } from "react"
import { ImagePlus, Loader2, Star, Trash2 } from "lucide-react"
import { Badge, Button } from "@myd-org/ui"
import { api, ErrorApi, type FotoDto } from "./tipos"
import { generarVariantes, ImagenInvalida, MAX_BYTES_ORIGINAL, TIPOS_ACEPTADOS } from "./redimensionar"

/**
 * Fotos de un producto.
 *
 * El archivo NO pasa por el servidor: se redimensiona en el navegador, se piden URLs PUT firmadas
 * y se sube directo a R2. El servidor sólo firma y, al final, persiste la lista de keys.
 *
 * La PRIMERA foto de la lista es la principal, que es la que la tienda muestra en la grilla. Por
 * eso se puede reordenar: es la única decisión visual que se toma desde acá.
 */

interface Props {
  alegraId: string
  fotos: FotoDto[]
  onCambio: (fotos: FotoDto[]) => void
}

/** Ancho que se usa para previsualizar en el panel. */
const ANCHO_MINIATURA = 320

interface VarianteFirmada {
  ancho: number
  key: string
  url: string
  headers: { "content-type": string }
}

export function FotosProducto({ alegraId, fotos, onCambio }: Props) {
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  /** Las fotos se agrupan por foto lógica: las tres variantes comparten el prefijo de la key. */
  const grupos = agrupar(fotos)

  async function subir(files: FileList | null) {
    if (!files || files.length === 0) return
    setSubiendo(true)
    setError("")
    try {
      const nuevas: FotoDto[] = []
      for (const file of Array.from(files)) {
        const variantes = await generarVariantes(file)

        const { id, variantes: firmadas } = await api<{ id: string; variantes: VarianteFirmada[] }>(
          `/api/admin/catalogo/productos/${encodeURIComponent(alegraId)}/fotos`,
          {
            method: "POST",
            body: JSON.stringify({
              variantes: variantes.map((v) => ({ ancho: v.ancho, bytes: v.blob.size })),
            }),
          },
        )
        void id

        for (const v of variantes) {
          const firmada = firmadas.find((f) => f.ancho === v.ancho)
          if (!firmada) throw new Error("El servidor no firmó una de las imágenes.")
          // Los headers son los MISMOS que se firmaron: si no coinciden, R2 responde 403.
          const res = await fetch(firmada.url, { method: "PUT", headers: firmada.headers, body: v.blob })
          if (!res.ok) throw new Error(`La subida falló (${res.status}).`)
          // La url la compone el servidor al responder el PUT; acá sólo importa la key.
          nuevas.push({ key: firmada.key, url: null, w: v.ancho })
        }
      }

      // Recién con todo arriba se persiste la lista: si algo falla a mitad, no queda una foto
      // registrada en la base apuntando a un objeto que nunca se subió.
      await persistir([...fotos, ...nuevas])
    } catch (err) {
      if (err instanceof ImagenInvalida) setError(err.message)
      else if (err instanceof ErrorApi) setError(err.message)
      else setError(err instanceof Error ? err.message : "No pudimos subir la imagen.")
    } finally {
      setSubiendo(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function persistir(lista: FotoDto[]) {
    const { producto } = await api<{ producto: { fotos: FotoDto[] } }>(
      `/api/admin/catalogo/productos/${encodeURIComponent(alegraId)}/fotos`,
      { method: "PUT", body: JSON.stringify({ fotos: lista.map((f) => ({ key: f.key, w: f.w, alt: f.alt })) }) },
    )
    onCambio(producto.fotos)
  }

  async function accion(fn: () => Promise<void>) {
    setError("")
    try {
      await fn()
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos guardar el cambio.")
    }
  }

  const eliminar = (prefijo: string) =>
    accion(() => persistir(fotos.filter((f) => prefijoDe(f.key) !== prefijo)))

  const hacerPrincipal = (prefijo: string) =>
    accion(() =>
      persistir([...fotos.filter((f) => prefijoDe(f.key) === prefijo), ...fotos.filter((f) => prefijoDe(f.key) !== prefijo)]),
    )

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          Fotos del producto
        </span>
        <Button variant="ghost" size="sm" disabled={subiendo} onClick={() => inputRef.current?.click()}>
          {subiendo ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
          {subiendo ? "Subiendo…" : "Agregar fotos"}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={TIPOS_ACEPTADOS.join(",")}
        multiple
        className="hidden"
        onChange={(e) => void subir(e.target.files)}
      />

      {grupos.length === 0 ? (
        <p className="rounded-[var(--radius)] p-3 text-xs"
           style={{ background: "var(--bg)", border: "1px dashed var(--border-strong)", color: "var(--ink-soft)" }}>
          Este producto no tiene fotos. Puede publicarlo igual: la foto no es condición para que la tienda lo muestre.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {grupos.map((g, i) => (
            <li
              key={g.prefijo}
              className="relative overflow-hidden rounded-[var(--radius)]"
              style={{ border: "1px solid var(--border)", width: 116 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- el host es R2, fuera de los dominios de next/image */}
              <img
                src={g.miniatura ?? ""}
                alt={g.alt ?? ""}
                width={116}
                height={116}
                style={{ width: 116, height: 116, objectFit: "cover", display: "block" }}
              />
              {i === 0 && (
                <span className="absolute left-1 top-1">
                  <Badge tone="neutral">Principal</Badge>
                </span>
              )}
              <div className="flex items-center justify-between gap-1 p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={i === 0}
                  title="Usar como principal"
                  onClick={() => void hacerPrincipal(g.prefijo)}
                >
                  <Star size={12} />
                </Button>
                <Button variant="ghost" size="sm" title="Quitar" onClick={() => void eliminar(g.prefijo)}>
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
        Se guardan tres tamaños de cada foto, generados en su navegador. Acepta JPG, PNG o WEBP de hasta{" "}
        {Math.round(MAX_BYTES_ORIGINAL / 1024 / 1024)} MB.
      </p>
    </section>
  )
}

/** `productos/{tenant}/{alegraId}/{uuid}` — lo que comparten las variantes de una misma foto. */
function prefijoDe(key: string): string {
  return key.replace(/-\d+\.webp$/, "")
}

interface Grupo {
  prefijo: string
  miniatura: string | null
  alt?: string
}

function agrupar(fotos: FotoDto[]): Grupo[] {
  const orden: string[] = []
  const porPrefijo = new Map<string, FotoDto[]>()
  for (const f of fotos) {
    const p = prefijoDe(f.key)
    if (!porPrefijo.has(p)) {
      porPrefijo.set(p, [])
      orden.push(p)
    }
    porPrefijo.get(p)?.push(f)
  }
  return orden.map((prefijo) => {
    const variantes = porPrefijo.get(prefijo) ?? []
    // La miniatura es la variante más chica disponible: si la foto original era pequeña, puede que
    // la de 320 no exista.
    const elegida =
      variantes.find((v) => v.w === ANCHO_MINIATURA) ?? [...variantes].sort((a, b) => a.w - b.w)[0]
    return { prefijo, miniatura: elegida?.url ?? null, alt: elegida?.alt }
  })
}
