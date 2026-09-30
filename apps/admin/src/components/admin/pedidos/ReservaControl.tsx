"use client"

import { useState } from "react"
import { Button, useToast } from "@myd-org/ui"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { fmtFechaPedido } from "./format"

// Vencimiento de la reserva de un pedido pendiente sin pago y, para admin+, "Extender reserva"
// (suma los días de reserva de las reglas de venta a partir de ahora). Un pedido que no reserva
// por vencimiento (confirmado, pagado, facturado) no muestra nada.

export function ReservaControl({ pedido, esAdminPlus, onChanged }: { pedido: PedidoDetalleDto; esAdminPlus: boolean; onChanged: (venceEn: string | null) => void }) {
  const [guardando, setGuardando] = useState(false)
  const { toast } = useToast()
  const [ahora] = useState(() => Date.now())
  if (!pedido.reserva) return null
  const { venceEn } = pedido.reserva
  const vencida = venceEn !== null && new Date(venceEn).getTime() < ahora

  async function extender() {
    setGuardando(true)
    try {
      const res = await fetch(`/api/admin/pedidos/${pedido.id}/reserva`, { method: "POST" })
      const json = (await res.json().catch(() => null)) as { error?: string; venceEn?: string | null } | null
      if (!res.ok || !json || !("venceEn" in json)) {
        toast({ title: json?.error ?? "No se pudo extender la reserva. Inténtelo nuevamente.", tone: "danger" })
        return
      }
      onChanged(json.venceEn ?? null)
      toast({ title: "La reserva se extendió.", tone: "success" })
    } catch {
      toast({ title: "Error de conexión. Inténtelo nuevamente.", tone: "danger" })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="mb-3 flex flex-col gap-2">
      <p className="text-sm" style={{ color: vencida ? "var(--red)" : "var(--ink-soft)" }}>
        {venceEn === null
          ? "Sin vencimiento."
          : `La reserva ${vencida ? "venció" : "vence"} el ${fmtFechaPedido(venceEn)}.`}
      </p>
      {esAdminPlus && (
        <div>
          <Button variant="secondary" size="sm" loading={guardando} onClick={() => void extender()}>
            Extender reserva
          </Button>
        </div>
      )}
    </div>
  )
}
