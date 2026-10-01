"use client"

// Hook compartido para cambiar el estado de un pedido: lo usan `CambiarEstadoControl` (Select +
// botón, en el detalle) y `PedidosTablero` (arrastrar una tarjeta u "Otro estado" en el tablero).
// Concentra acá lo que las dos UI necesitan igual: el PATCH, el diálogo de motivo de cancelación
// y la confirmación extra de "entregado sin factura" — así no se duplica esa lógica ni sus textos.

import { useCallback, useState } from "react"
import { useToast } from "@myd-org/ui"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import type { EntregaTipo, EstadoPedido } from "@/lib/pedidos-transiciones"
import { interpretarRespuestaCambio, motivoValido } from "./logica"

export const AVISO_SIN_FACTURA =
  "Este pedido no tiene factura vinculada. Si lo marca como entregado, deja de reservar stock y Alegra " +
  "no lo descuenta hasta que se facture. ¿Desea continuar?"

interface PedidoBase {
  id: string
  estado: EstadoPedido
}

export interface UseCambiarEstadoInput<T extends PedidoBase> {
  /** 200: el PATCH devuelve el detalle completo (o, en el tablero, lo que haga falta pintar). */
  onChanged: (pedido: T) => void
  /** 409: otro usuario lo cambió antes; hay que volver a pedir el pedido/la lista. */
  onConflicto: () => void
}

/**
 * Intención de cambio pendiente de confirmar: qué pedido, a qué destino, y si hace falta un
 * diálogo antes de mandar el PATCH ("motivo" para cancelar, "sinFactura" para entregar sin
 * factura). `null` = ningún diálogo abierto.
 */
export type IntencionCambio<T extends PedidoBase> =
  | { tipo: "motivo"; pedido: T; destino: "cancelado" }
  | { tipo: "sinFactura"; pedido: T; destino: EstadoPedido }
  | { tipo: "forzado"; pedido: T; destino: "cancelado" }

export function useCambiarEstado<T extends PedidoBase>({ onChanged, onConflicto }: UseCambiarEstadoInput<T>) {
  const { toast } = useToast()
  const [intencion, setIntencion] = useState<IntencionCambio<T> | null>(null)
  const [motivo, setMotivo] = useState("")
  const [guardando, setGuardando] = useState(false)

  const cerrar = useCallback(() => {
    setIntencion(null)
    setMotivo("")
  }, [])

  const enviar = useCallback(
    async (pedido: T, destino: EstadoPedido, motivoCancelacion?: string, forzar = false) => {
      setGuardando(true)
      const res = await fetch(`/api/admin/pedidos/${pedido.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: destino,
          estadoEsperado: pedido.estado,
          ...(motivoCancelacion !== undefined ? { motivo: motivoCancelacion } : {}),
          ...(forzar ? { forzar: true } : {}),
        }),
      }).catch(() => null)
      const body: unknown = res ? await res.json().catch(() => null) : null
      const resultado = interpretarRespuestaCambio<PedidoDetalleDto>(res?.status ?? null, body)
      setGuardando(false)

      if (resultado.tipo === "ok") {
        cerrar()
        toast({ title: "El estado del pedido se actualizó.", tone: "success" })
        onChanged(resultado.pedido as unknown as T)
        return
      }
      toast({ title: resultado.mensaje, tone: "danger" })
      if (resultado.tipo === "conflicto") {
        cerrar()
        onConflicto()
      }
      // Error común (400/422/red): el diálogo (si había uno) queda abierto para reintentar.
    },
    [cerrar, onChanged, onConflicto, toast],
  )

  /**
   * Punto de entrada único: `pedido` + `destino` + si el pedido YA tiene factura. Decide si hace
   * falta un diálogo (cancelar, o entregar sin factura) o si el PATCH se manda directo.
   */
  const pedirCambio = useCallback(
    (pedido: T, destino: EstadoPedido, tieneFactura: boolean) => {
      if (destino === "cancelado") {
        setMotivo("")
        setIntencion({ tipo: "motivo", pedido, destino: "cancelado" })
        return
      }
      if (destino === "entregado" && !tieneFactura) {
        setIntencion({ tipo: "sinFactura", pedido, destino })
        return
      }
      void enviar(pedido, destino)
    },
    [enviar],
  )

  const confirmarCancelacion = useCallback(() => {
    if (!intencion || intencion.tipo !== "motivo") return
    void enviar(intencion.pedido, "cancelado", motivo.trim())
  }, [enviar, intencion, motivo])

  /** Abre el diálogo de "Cancelar con devolución" (sólo se ofrece a admin o superior). */
  const pedirCancelacionForzada = useCallback((pedido: T) => {
    setMotivo("")
    setIntencion({ tipo: "forzado", pedido, destino: "cancelado" })
  }, [])

  const confirmarCancelacionForzada = useCallback(() => {
    if (!intencion || intencion.tipo !== "forzado") return
    void enviar(intencion.pedido, "cancelado", motivo.trim(), true)
  }, [enviar, intencion, motivo])

  const confirmarSinFactura = useCallback(() => {
    if (!intencion || intencion.tipo !== "sinFactura") return
    void enviar(intencion.pedido, intencion.destino)
  }, [enviar, intencion])

  return {
    intencion,
    motivo,
    setMotivo,
    guardando,
    puedeCancelar: motivoValido(motivo),
    pedirCambio,
    confirmarCancelacion,
    confirmarSinFactura,
    pedirCancelacionForzada,
    confirmarCancelacionForzada,
    cerrar,
  }
}
