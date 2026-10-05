"use client"

import { useState } from "react"
import { Button, Dialog, Field, Select, Textarea } from "@myd-org/ui"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { MOTIVO_MAX, type EntregaTipo, type EstadoPedido } from "@/lib/pedidos-transiciones"
import { opcionesDeDestino } from "./logica"
import { MotivosFrecuentes } from "./MotivosFrecuentes"
import { AVISO_SIN_FACTURA, useCambiarEstado } from "./useCambiarEstado"

interface Props {
  pedidoId: string
  /** Estado que se está MOSTRANDO: viaja como `estadoEsperado` (concurrencia optimista). */
  estado: EstadoPedido
  /** Tipo de entrega del pedido: decide si `en_camino` es un destino ofrecido. */
  entregaTipo: EntregaTipo
  /** Si el pedido ya tiene una factura de Alegra vinculada (`pedido.factura !== null`). */
  tieneFactura: boolean
  /** 200: el PATCH devuelve el detalle completo y reemplaza al que está en pantalla. */
  onChanged: (pedido: PedidoDetalleDto) => void
  /** 409: otro usuario lo cambió antes; hay que volver a pedir el pedido. */
  onConflicto: () => void
}

const SIN_DESTINO = ""

export function CambiarEstadoControl({ pedidoId, estado, entregaTipo, tieneFactura, onChanged, onConflicto }: Props) {
  // "" = nada elegido: Radix lo toma como "mostrar el placeholder" (no es el value de un ítem).
  const [destino, setDestino] = useState<string>(SIN_DESTINO)
  const { intencion, motivo, setMotivo, guardando, puedeCancelar, pedirCambio, confirmarCancelacion, confirmarSinFactura, cerrar } =
    useCambiarEstado<{ id: string; estado: EstadoPedido }>({
      onChanged: (p) => onChanged(p as unknown as PedidoDetalleDto),
      onConflicto,
    })

  const opciones = opcionesDeDestino(estado, entregaTipo)

  if (opciones.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
        Este pedido está cancelado y no admite más cambios de estado.
      </p>
    )
  }

  function cerrarTodo() {
    cerrar()
    setDestino(SIN_DESTINO)
  }

  function elegir(valor: string) {
    setDestino(valor)
    // Cancelar no se guarda con el botón común: pide el motivo apenas se elige, en su diálogo.
    if (valor === "cancelado") pedirCambio({ id: pedidoId, estado }, "cancelado", tieneFactura)
  }

  function guardar() {
    if (destino === SIN_DESTINO || destino === "cancelado") return
    pedirCambio({ id: pedidoId, estado }, destino as EstadoPedido, tieneFactura)
  }

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="w-full sm:w-64">
          <Field label="Cambiar estado">
            <Select
              value={destino}
              onValueChange={elegir}
              options={opciones}
              placeholder="Seleccione el nuevo estado"
              disabled={guardando}
            />
          </Field>
        </div>
        <Button
          onClick={guardar}
          disabled={destino === SIN_DESTINO || destino === "cancelado"}
          loading={guardando && intencion === null}
        >
          Guardar
        </Button>
      </div>

      <Dialog
        dismissible={false}
        open={intencion?.tipo === "motivo"}
        onOpenChange={(open) => { if (!open && !guardando) cerrarTodo() }}
        title="Cancelar pedido"
        description="Esta acción no se puede deshacer. Indique el motivo de la cancelación."
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={cerrarTodo} disabled={guardando}>Volver</Button>
            <Button variant="danger" loading={guardando} disabled={!puedeCancelar} onClick={confirmarCancelacion}>
              Cancelar pedido
            </Button>
          </div>
        }
      >
        <Field label="Motivo" hint={`${motivo.length}/${MOTIVO_MAX}`}>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={4}
            maxLength={MOTIVO_MAX}
            required
            aria-required="true"
            disabled={guardando}
          />
        </Field>
        <MotivosFrecuentes onElegir={(m) => setMotivo(m.slice(0, MOTIVO_MAX))} disabled={guardando} />
      </Dialog>

      <Dialog
        open={intencion?.tipo === "sinFactura"}
        onOpenChange={(open) => { if (!open && !guardando) cerrarTodo() }}
        title="Marcar como entregado"
        description={AVISO_SIN_FACTURA}
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={cerrarTodo} disabled={guardando}>Volver</Button>
            <Button loading={guardando} onClick={confirmarSinFactura}>Continuar</Button>
          </div>
        }
      />
    </>
  )
}
