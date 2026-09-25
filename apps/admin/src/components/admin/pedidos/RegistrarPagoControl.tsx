"use client"

import { useState } from "react"
import { Button, Dialog, useToast } from "@myd-org/ui"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { interpretarRespuestaCambio } from "./logica"

// "Registrar pago": para transferencia, efectivo y cuenta corriente, el operador marca el pedido
// como pagado cuando le llega la plata (POST) y el cliente recibe un mail. "Anular pago" (DELETE)
// deshace uno cargado por error. Los pagos en línea no muestran nada: los mueve el proveedor.

interface Props {
  pedido: PedidoDetalleDto
  onChanged: (pedido: PedidoDetalleDto) => void
}

type Accion = "registrar" | "anular"

export function RegistrarPagoControl({ pedido, onChanged }: Props) {
  const { toast } = useToast()
  const [confirmar, setConfirmar] = useState<Accion | null>(null)
  const [guardando, setGuardando] = useState(false)

  if (!pedido.pagoManual) return null
  const pagado = pedido.pagoEstado === "pagado"
  if (!pagado && pedido.estado === "cancelado") return null

  async function enviar(accion: Accion) {
    setGuardando(true)
    const res = await fetch(`/api/admin/pedidos/${pedido.id}/pago`, {
      method: accion === "registrar" ? "POST" : "DELETE",
    }).catch(() => null)
    const body: unknown = res ? await res.json().catch(() => null) : null
    const resultado = interpretarRespuestaCambio<PedidoDetalleDto>(res?.status ?? null, body)
    setGuardando(false)
    if (resultado.tipo === "ok") {
      setConfirmar(null)
      toast({ title: accion === "registrar" ? "El pago quedó registrado." : "El pago se anuló.", tone: "success" })
      onChanged(resultado.pedido)
      return
    }
    toast({ title: resultado.mensaje, tone: "danger" })
  }

  const sinEmail = !pedido.cliente.email

  return (
    <>
      <div className="mt-3">
        {pagado ? (
          <Button variant="ghost" onClick={() => setConfirmar("anular")}>Anular pago</Button>
        ) : (
          <Button onClick={() => setConfirmar("registrar")}>Registrar pago</Button>
        )}
      </div>

      <Dialog
        open={confirmar !== null}
        onOpenChange={(open) => { if (!open && !guardando) setConfirmar(null) }}
        title={confirmar === "anular" ? "Anular pago" : "Registrar pago"}
        description={
          confirmar === "anular"
            ? "El pedido volverá a quedar con el pago pendiente. No se le avisará al cliente."
            : sinEmail
              ? "Confirme que recibió el pago de este pedido. El pedido no tiene email, así que no se le avisará al cliente."
              : `Confirme que recibió el pago de este pedido. Le enviaremos un aviso por email a ${pedido.cliente.email}.`
        }
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setConfirmar(null)} disabled={guardando}>Volver</Button>
            <Button
              variant={confirmar === "anular" ? "danger" : "primary"}
              loading={guardando}
              onClick={() => confirmar && void enviar(confirmar)}
            >
              {confirmar === "anular" ? "Anular pago" : "Registrar pago"}
            </Button>
          </div>
        }
      />
    </>
  )
}
