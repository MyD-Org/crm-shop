"use client"

import type { ReactNode } from "react"
import { Info } from "lucide-react"
import { Tooltip } from "@myd-org/ui"

/**
 * Ícono de ayuda (i) con un tooltip del DS. Para explicar en el lugar qué hace una opción del
 * panel. `etiqueta` es el nombre accesible del botón ("Ayuda: Visible en"); el texto largo va en
 * `texto` y lo lee el tooltip.
 */
export function AyudaTooltip({
  texto,
  etiqueta,
  side,
}: {
  texto: ReactNode
  etiqueta: string
  side?: "top" | "right" | "bottom" | "left"
}) {
  return (
    <Tooltip content={texto} side={side}>
      <button
        type="button"
        aria-label={`Ayuda: ${etiqueta}`}
        className="inline-flex cursor-help items-center bg-transparent p-0 align-middle"
        onClick={(e) => e.stopPropagation()}
      >
        <Info size={13} strokeWidth={1.6} style={{ color: "var(--ink-faint)" }} />
      </button>
    </Tooltip>
  )
}
