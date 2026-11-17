"use client"

import { Button, Dialog } from "@myd-org/ui"
import { ROLLOS, type TipoEtiqueta } from "@/lib/etiquetas/trabajos"

interface Props {
  tipo: TipoEtiqueta
  abierto: boolean
  etiquetas: number
  onCancelar: () => void
  onConfirmar: () => void
}

/** Confirmación obligatoria del rollo antes de cada impresión: sin confirmar no se envía nada. */
export function ConfirmarRollo({ tipo, abierto, etiquetas, onCancelar, onConfirmar }: Props) {
  const rollo = ROLLOS[tipo]
  return (
    <Dialog
      open={abierto}
      onOpenChange={(o) => {
        if (!o) onCancelar()
      }}
      title={rollo.titulo}
      description={rollo.detalle}
      footer={
        <>
          <Button variant="secondary" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button onClick={onConfirmar}>Imprimir</Button>
        </>
      }
    >
      <p className="text-sm">
        {etiquetas === 1
          ? "Se va a imprimir 1 etiqueta."
          : `Se van a imprimir ${etiquetas} etiquetas.`}{" "}
        Verifique que el rollo correcto esté cargado antes de continuar.
      </p>
    </Dialog>
  )
}
