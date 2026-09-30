"use client"

import { Button } from "@myd-org/ui"
import { MOTIVOS_FRECUENTES } from "./logica"

/**
 * Atajos para el motivo de cancelación (p. ej. "Sin respuesta del cliente", el motivo típico de la
 * cola "Sin contactar"). Completan el texto y el operador puede editarlo antes de confirmar.
 */
export function MotivosFrecuentes({ onElegir, disabled }: { onElegir: (motivo: string) => void; disabled?: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
        Motivos frecuentes:
      </span>
      {MOTIVOS_FRECUENTES.map((m) => (
        <Button key={m} size="sm" variant="ghost" disabled={disabled} onClick={() => onElegir(m)}>
          {m}
        </Button>
      ))}
    </div>
  )
}
