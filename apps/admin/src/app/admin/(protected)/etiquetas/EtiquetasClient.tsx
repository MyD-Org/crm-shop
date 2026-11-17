"use client"

import { useState } from "react"
import { Alert, Button, Card, Field, Progress, SegmentedControl } from "@myd-org/ui"
import { useImpresora, type EstadoImpresora } from "@/lib/etiquetas/useImpresora"
import { ROLLOS_PRUEBA, type RolloPrueba } from "@/lib/etiquetas/usb"

// Pantalla PROVISIONAL (R2 de etiquetas-desde-crm): sólo conectar la impresora e imprimir una
// prueba, para validar WebUSB con la impresora real. R3 la reemplaza por la pantalla completa
// (selección de productos, vista previa, confirmación de rollo) y agrega la entrada del menú.

const TEXTO_ESTADO: Record<EstadoImpresora, string> = {
  verificando: "Comprobando la impresora…",
  "sin-soporte": "Este navegador no puede imprimir por USB.",
  "sin-conectar": "No hay una impresora conectada.",
  conectada: "Impresora conectada.",
  imprimiendo: "Enviando a la impresora…",
  error: "No se pudo completar la última operación.",
}

export function EtiquetasClient() {
  const impresora = useImpresora()
  const [rollo, setRollo] = useState<RolloPrueba>("chico")
  const ocupada = impresora.estado === "imprimiendo" || impresora.estado === "verificando"
  const { progreso } = impresora

  return (
    <div className="max-w-xl">
      <Card
        title="Impresora de etiquetas"
        description="Conecte la impresora por USB y envíe una etiqueta de prueba para verificar la conexión."
      >
        <div className="space-y-4">
          <p className="text-sm" role="status">{TEXTO_ESTADO[impresora.estado]}</p>

          {impresora.estado === "sin-soporte" && <Alert tone="warning">{impresora.error}</Alert>}
          {impresora.estado === "error" && impresora.error && <Alert tone="danger">{impresora.error}</Alert>}
          {impresora.aviso && <Alert tone="success">{impresora.aviso}</Alert>}

          {progreso && (
            <Progress
              value={progreso.total ? Math.round((progreso.enviados / progreso.total) * 100) : 0}
              aria-label="Envío a la impresora"
            />
          )}

          <Field label="Rollo cargado">
            <SegmentedControl
              ariaLabel="Rollo cargado en la impresora"
              options={ROLLOS_PRUEBA}
              value={rollo}
              onValueChange={(v) => setRollo(v as RolloPrueba)}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => void impresora.conectar()}
              disabled={impresora.estado === "sin-soporte" || ocupada}
            >
              Conectar impresora
            </Button>
            <Button
              onClick={() => void impresora.imprimirPrueba(rollo)}
              disabled={!impresora.tieneDispositivo || ocupada}
              loading={impresora.estado === "imprimiendo"}
            >
              Imprimir prueba
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
