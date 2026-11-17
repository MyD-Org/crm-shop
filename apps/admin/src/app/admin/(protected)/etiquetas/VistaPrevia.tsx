"use client"

import { useEffect, useRef, useState } from "react"
import { dibujarFilaCodigos, dibujarHojaQr6 } from "@/lib/etiquetas/canvas"
import { layoutQr6, primeraFilaTspl, trabajoCodigos, type ItemEtiqueta, type TipoEtiqueta } from "@/lib/etiquetas/trabajos"

interface Props {
  tipo: TipoEtiqueta
  items: ItemEtiqueta[]
  shopUrl: string | null
}

/**
 * Primera fila (29x20) o primera hoja (QR 6 por hoja) dibujada con las MISMAS funciones que arman
 * lo que se envía a la impresora.
 */
export function VistaPrevia({ tipo, items, shopUrl }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [vacia, setVacia] = useState(true)

  useEffect(() => {
    let vigente = true
    const t = setTimeout(async () => {
      let img: ImageData | null = null
      try {
        if (tipo === "codigos-29x20") {
          const primero = trabajoCodigos(items).trabajos[0]
          if (primero) img = dibujarFilaCodigos(primeraFilaTspl(new TextDecoder().decode(primero.datos)))
        } else if (tipo === "qr-6up") {
          const layout = layoutQr6(items, shopUrl)
          if (layout.ok && layout.hojas[0]) img = await dibujarHojaQr6(layout.hojas[0])
        }
      } catch (e) {
        console.error("[etiquetas] vista previa:", e)
      }
      const canvas = ref.current
      if (!vigente || !canvas) return
      setVacia(!img)
      if (!img) return
      canvas.width = img.width
      canvas.height = img.height
      canvas.getContext("2d")?.putImageData(img, 0, 0)
    }, 200)
    return () => {
      vigente = false
      clearTimeout(t)
    }
  }, [tipo, items, shopUrl])

  const anchoMax = tipo === "codigos-29x20" ? 520 : 320
  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={ref}
        aria-label="Vista previa de la etiqueta"
        role="img"
        hidden={vacia}
        style={{ width: "100%", maxWidth: anchoMax, height: "auto", border: "1px solid var(--border)", background: "#fff" }}
      />
      {vacia && (
        <p className="text-sm" style={{ color: "var(--ink-faint)" }}>
          La vista previa aparece cuando hay etiquetas para imprimir.
        </p>
      )}
    </div>
  )
}
