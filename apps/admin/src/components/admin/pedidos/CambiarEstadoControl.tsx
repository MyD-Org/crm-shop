"use client"

import { useState } from "react"
import { Button, Dialog, Field, Select, Textarea, useToast } from "@myd-org/ui"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { MOTIVO_MAX, type EntregaTipo, type EstadoPedido } from "@/lib/pedidos-transiciones"
import { interpretarRespuestaCambio, motivoValido, opcionesDeDestino } from "./logica"

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

const AVISO_SIN_FACTURA =
  "Este pedido no tiene factura vinculada. Si lo marca como entregado, deja de reservar stock y Alegra " +
  "no lo descuenta hasta que se facture. ¿Desea continuar?"

export function CambiarEstadoControl({ pedidoId, estado, entregaTipo, tieneFactura, onChanged, onConflicto }: Props) {
  const { toast } = useToast()
  // "" = nada elegido: Radix lo toma como "mostrar el placeholder" (no es el value de un ítem).
  const [destino, setDestino] = useState<string>(SIN_DESTINO)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [guardando, setGuardando] = useState(false)
  // "Entregado" sin factura vinculada: se pide una confirmación extra, en su propio diálogo
  // (sólo UI: el servidor no bloquea esta transición aunque falte la factura).
  const [confirmarSinFactura, setConfirmarSinFactura] = useState(false)

  const opciones = opcionesDeDestino(estado, entregaTipo)

  if (opciones.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
        Este pedido está cancelado y no admite más cambios de estado.
      </p>
    )
  }

  function cerrarDialogo() {
    setDialogoAbierto(false)
    setConfirmarSinFactura(false)
    setMotivo("")
    setDestino(SIN_DESTINO)
  }

  function elegir(valor: string) {
    setDestino(valor)
    // Cancelar no se guarda con el botón común: pide el motivo antes, en su propio diálogo.
    if (valor === "cancelado") setDialogoAbierto(true)
  }

  function guardar() {
    // Entregado sin factura: primero el aviso, recién con la confirmación se manda el PATCH.
    if (destino === "entregado" && !tieneFactura) {
      setConfirmarSinFactura(true)
      return
    }
    void enviar(destino)
  }

  async function enviar(nuevo: string, motivoCancelacion?: string) {
    setGuardando(true)
    const res = await fetch(`/api/admin/pedidos/${pedidoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        estado: nuevo,
        estadoEsperado: estado,
        ...(motivoCancelacion !== undefined ? { motivo: motivoCancelacion } : {}),
      }),
    }).catch(() => null)
    const body: unknown = res ? await res.json().catch(() => null) : null
    const resultado = interpretarRespuestaCambio<PedidoDetalleDto>(res?.status ?? null, body)
    setGuardando(false)

    if (resultado.tipo === "ok") {
      cerrarDialogo()
      toast({ title: "El estado del pedido se actualizó.", tone: "success" })
      onChanged(resultado.pedido)
      return
    }
    toast({ title: resultado.mensaje, tone: "danger" })
    if (resultado.tipo === "conflicto") {
      // Lo que está en pantalla ya no es verdad: se cierra todo y se recarga el pedido.
      cerrarDialogo()
      onConflicto()
    }
    // Error común (400/422/red): el diálogo queda abierto con el motivo escrito, para reintentar.
  }

  const puedeCancelar = motivoValido(motivo)

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
          loading={guardando && !dialogoAbierto && !confirmarSinFactura}
        >
          Guardar
        </Button>
      </div>

      <Dialog
        open={dialogoAbierto}
        onOpenChange={(open) => { if (!open && !guardando) cerrarDialogo() }}
        title="Cancelar pedido"
        description="Esta acción no se puede deshacer. Indique el motivo de la cancelación."
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={cerrarDialogo} disabled={guardando}>Volver</Button>
            <Button
              variant="danger"
              loading={guardando}
              disabled={!puedeCancelar}
              onClick={() => void enviar("cancelado", motivo.trim())}
            >
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
      </Dialog>

      <Dialog
        open={confirmarSinFactura}
        onOpenChange={(open) => { if (!open && !guardando) setConfirmarSinFactura(false) }}
        title="Marcar como entregado"
        description={AVISO_SIN_FACTURA}
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setConfirmarSinFactura(false)} disabled={guardando}>
              Volver
            </Button>
            <Button loading={guardando} onClick={() => void enviar(destino)}>
              Continuar
            </Button>
          </div>
        }
      />
    </>
  )
}
