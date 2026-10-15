"use client"

import { Field, Input, Switch } from "@myd-org/ui"
import { MAX_TEXTO_BANNER, type BannerMedio } from "@/lib/medios-pago-shop-chips"

// Editor del banner de ahorro de un medio de pago (la franja verde del checkout). Controlado: el
// padre lo guarda junto con las etiquetas.

export interface EditorBannerMedioProps {
  id: string
  banner: BannerMedio
  onChange: (banner: BannerMedio) => void
  error?: string
}

export function EditorBannerMedio({ id, banner, onChange, error }: EditorBannerMedioProps) {
  return (
    <div className="flex flex-col gap-2" data-testid="editor-banner">
      <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>Banner de ahorro</p>
      <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
        Franja verde sobre este medio en el checkout, con cuánto ahorra el cliente frente a la opción más cara. Solo
        aparece cuando hay ahorro. En el texto, {"{ahorro}"} es el monto y {"{frente}"} el nombre de la opción más
        cara; puede escribir lo que quiera, por ejemplo «Ahorra {"{ahorro}"} frente a otros medios de pago».
      </p>
      <Switch
        id={`${id}-activo`}
        label="Mostrar banner"
        checked={banner.activo}
        onCheckedChange={(v) => onChange({ ...banner, activo: v })}
      />
      <Field label="Texto del banner" error={error}>
        <Input
          value={banner.texto}
          maxLength={MAX_TEXTO_BANNER}
          disabled={!banner.activo}
          onChange={(e) => onChange({ ...banner, texto: e.target.value })}
          aria-invalid={Boolean(error)}
        />
      </Field>
    </div>
  )
}
