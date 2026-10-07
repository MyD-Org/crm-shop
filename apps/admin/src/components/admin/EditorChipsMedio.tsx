"use client"

import { Badge, Button, Field, Input, Select } from "@myd-org/ui"
import {
  ETIQUETA_TONO_CHIP,
  MAX_CHIPS,
  MAX_TEXTO_CHIP,
  TONOS_CHIP,
  TONO_BADGE_DE_CHIP,
  moverChip,
  type ChipMedio,
  type TonoChip,
} from "@/lib/medios-pago-shop-chips"

// Editor de las etiquetas de un medio de pago (tarjeta "Medios de pago del checkout"): agregar,
// editar, quitar y reordenar, con vista previa del Badge tal como la ve el cliente en el checkout.
// Controlado: el padre guarda la lista junto con el resto del medio.

export interface EditorChipsMedioProps {
  chips: ChipMedio[]
  onChange: (chips: ChipMedio[]) => void
  error?: string
}

export function EditorChipsMedio({ chips, onChange, error }: EditorChipsMedioProps) {
  const cambiarChip = (i: number, parcial: Partial<ChipMedio>) =>
    onChange(chips.map((c, j) => (j === i ? { ...c, ...parcial } : c)))

  return (
    <div className="flex flex-col gap-2" data-testid="editor-chips">
      <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>Etiquetas</p>
      <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
        Se muestran resaltadas sobre este medio de pago en el checkout, en este orden. Hasta {MAX_CHIPS} etiquetas de
        {" "}{MAX_TEXTO_CHIP} caracteres, por ejemplo «Hasta 8 cuotas sin interés», «Recomendado» o «15% OFF».
      </p>
      {chips.map((c, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <Field label="Texto">
            <Input
              value={c.texto}
              maxLength={MAX_TEXTO_CHIP}
              aria-label={`Texto de la etiqueta ${i + 1}`}
              onChange={(e) => cambiarChip(i, { texto: e.target.value })}
            />
          </Field>
          <Field label="Tono">
            <Select
              aria-label={`Tono de la etiqueta ${i + 1}`}
              value={c.tono}
              onValueChange={(v) => cambiarChip(i, { tono: v as TonoChip })}
              options={TONOS_CHIP.map((t) => ({ value: t, label: ETIQUETA_TONO_CHIP[t] }))}
            />
          </Field>
          <div className="flex items-center gap-1 pb-1" aria-label={`Vista previa de la etiqueta ${i + 1}`}>
            <Badge tone={TONO_BADGE_DE_CHIP[c.tono]}>{c.texto.trim() || "Vista previa"}</Badge>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={i === 0} aria-label={`Subir la etiqueta ${i + 1}`} onClick={() => onChange(moverChip(chips, i, -1))}>
              Subir
            </Button>
            <Button size="sm" variant="ghost" disabled={i === chips.length - 1} aria-label={`Bajar la etiqueta ${i + 1}`} onClick={() => onChange(moverChip(chips, i, 1))}>
              Bajar
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Quitar la etiqueta ${i + 1}`} onClick={() => onChange(chips.filter((_, j) => j !== i))}>
              Quitar
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={chips.length >= MAX_CHIPS}
          onClick={() => onChange([...chips, { texto: "", tono: "destacado" }])}
        >
          Agregar etiqueta
        </Button>
      </div>
      {error && <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>{error}</p>}
    </div>
  )
}
