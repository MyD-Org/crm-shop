"use client"

import { useEffect, useState } from "react"
import { Badge, Button, useToast } from "@myd-org/ui"
import type { EstadoPedido } from "@/lib/pedidos-transiciones"
import { textoSinContactar } from "@/lib/pedido-contacto"
import { fmtFechaPedido } from "./format"

// Seguimiento de contacto de un pedido pendiente (change `sucursales-igz-mdp`, rebanada B):
// muestra si ya se contactó al cliente y permite marcarlo. La acción aparece solo mientras el
// pedido está pendiente.

interface Estado {
  umbralHoras: number
  contactadoEn: string | null
  contactadoPorNombre: string | null
}

export function ContactoControl({ pedidoId, estado, creadoEn }: { pedidoId: string; estado: EstadoPedido; creadoEn: string }) {
  const [datos, setDatos] = useState<Estado | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [ahora] = useState(() => Date.now())
  const { toast } = useToast()

  useEffect(() => {
    let vivo = true
    fetch(`/api/admin/pedidos/${pedidoId}/contacto`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as Estado | null
        if (vivo && res.ok && json) setDatos(json)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [pedidoId])

  if (!datos) return null
  if (!datos.contactadoEn && estado !== "pendiente") return null

  async function marcar() {
    setGuardando(true)
    try {
      const res = await fetch(`/api/admin/pedidos/${pedidoId}/contacto`, { method: "POST" })
      const json = (await res.json().catch(() => null)) as
        | { error?: string; contactadoEn?: string; contactadoPorNombre?: string | null }
        | null
      if (!res.ok || !json?.contactadoEn) {
        toast({ title: json?.error ?? "No se pudo marcar el pedido como contactado. Inténtelo nuevamente.", tone: "danger" })
        return
      }
      setDatos((d) => (d ? { ...d, contactadoEn: json.contactadoEn ?? null, contactadoPorNombre: json.contactadoPorNombre ?? null } : d))
      toast({ title: "Pedido marcado como contactado", tone: "success" })
    } catch {
      toast({ title: "Error de conexión. Inténtelo nuevamente.", tone: "danger" })
    } finally {
      setGuardando(false)
    }
  }

  if (datos.contactadoEn) {
    return (
      <p className="mb-3 text-sm" style={{ color: "var(--ink-soft)" }}>
        Contactado el {fmtFechaPedido(datos.contactadoEn)}
        {datos.contactadoPorNombre ? ` por ${datos.contactadoPorNombre}` : ""}.
      </p>
    )
  }

  const vencido = datos.umbralHoras > 0 && ahora - new Date(creadoEn).getTime() > datos.umbralHoras * 3_600_000
  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {vencido ? <Badge tone="danger">{textoSinContactar(new Date(creadoEn), new Date(ahora))}</Badge> : <Badge tone="neutral">Sin contactar</Badge>}
      </div>
      <div>
        <Button variant="secondary" size="sm" loading={guardando} onClick={() => void marcar()}>
          Marcar contactado
        </Button>
      </div>
    </div>
  )
}
