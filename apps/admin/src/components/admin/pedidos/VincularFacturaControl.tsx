"use client"

import { useState } from "react"
import { Alert, Button, Dialog, Field, Input, useToast } from "@myd-org/ui"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { fmtFechaDia, fmtMoneda, textoUltimoCambio } from "./format"
import { interpretarRespuestaFactura } from "./logica"

// "Vincular factura": el operador hizo la factura en Alegra por fuera y la vincula al pedido.
// Buscar (GET) no guarda nada; recién "Vincular" (POST) la guarda, marca el pedido como
// facturado y libera la reserva de stock. "Desvincular" (DELETE) lo deshace. Toda validación
// real es del servidor (vuelve a leer la factura de Alegra al vincular).

interface FacturaEncontrada {
  factura: {
    alegraId: string
    numero: string | null
    fecha: string
    total: number
    estado: string
    clienteNombre: string | null
  }
  clienteVerificado: boolean
  otrosPedidos: string[]
}

interface Props {
  pedido: PedidoDetalleDto
  onChanged: (pedido: PedidoDetalleDto) => void
  /** 409: otro operador lo cambió; hay que volver a pedir el pedido. */
  onConflicto: () => void
}

const esDetalle = (b: unknown) => typeof (b as { id?: unknown }).id === "string"
const esEncontrada = (b: unknown) => typeof (b as FacturaEncontrada).factura?.alegraId === "string"

function Fila({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt style={{ color: "var(--ink-soft)" }}>{label}</dt>
      <dd className="text-right tabular-nums" style={{ color: "var(--ink)" }}>{children || "—"}</dd>
    </div>
  )
}

export function VincularFacturaControl({ pedido, onChanged, onConflicto }: Props) {
  const { toast } = useToast()
  const [numero, setNumero] = useState("")
  const [buscando, setBuscando] = useState(false)
  const [encontrada, setEncontrada] = useState<FacturaEncontrada | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [confirmarDesvincular, setConfirmarDesvincular] = useState(false)

  const base = `/api/admin/pedidos/${pedido.id}/factura`

  async function llamar(url: string, init?: RequestInit) {
    const res = await fetch(url, { cache: "no-store", ...init }).catch(() => null)
    const body: unknown = res ? await res.json().catch(() => null) : null
    return { status: res?.status ?? null, body }
  }

  async function buscar() {
    if (!numero.trim()) return
    setBuscando(true)
    const { status, body } = await llamar(`${base}?numero=${encodeURIComponent(numero.trim())}`)
    setBuscando(false)
    const r = interpretarRespuestaFactura<FacturaEncontrada>(status, body, esEncontrada)
    if (r.tipo === "ok") {
      setEncontrada(r.valor)
      return
    }
    toast({ title: r.mensaje, tone: "danger" })
    if (r.tipo === "conflicto") onConflicto()
  }

  async function vincular() {
    if (!encontrada) return
    setGuardando(true)
    const { status, body } = await llamar(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alegraId: encontrada.factura.alegraId }),
    })
    setGuardando(false)
    const r = interpretarRespuestaFactura<PedidoDetalleDto>(status, body, esDetalle)
    if (r.tipo === "ok") {
      setEncontrada(null)
      setNumero("")
      toast({ title: "La factura quedó vinculada y el pedido figura como facturado.", tone: "success" })
      onChanged(r.valor)
      return
    }
    toast({ title: r.mensaje, tone: "danger" })
    if (r.tipo === "conflicto") {
      setEncontrada(null)
      onConflicto()
    }
  }

  async function desvincular() {
    const esperada = pedido.factura?.alegraId
    setGuardando(true)
    const { status, body } = await llamar(esperada ? `${base}?alegraId=${encodeURIComponent(esperada)}` : base, {
      method: "DELETE",
    })
    setGuardando(false)
    setConfirmarDesvincular(false)
    const r = interpretarRespuestaFactura<PedidoDetalleDto>(status, body, esDetalle)
    if (r.tipo === "ok") {
      toast({ title: "La factura se desvinculó del pedido.", tone: "success" })
      onChanged(r.valor)
      return
    }
    toast({ title: r.mensaje, tone: "danger" })
    if (r.tipo === "conflicto") onConflicto()
  }

  const reserva = (
    <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
      {pedido.reservaStock
        ? "Este pedido está reservando stock en la tienda."
        : "Este pedido no está reservando stock en la tienda."}
    </p>
  )

  if (pedido.factura) {
    const vinculada = textoUltimoCambio(pedido.facturadoPorNombre, pedido.facturadoEn)
    return (
      <div className="flex flex-col gap-3">
        <dl className="flex max-w-sm flex-col gap-1">
          <Fila label="Factura">{pedido.factura.numero ?? `Id ${pedido.factura.alegraId} en Alegra`}</Fila>
          <Fila label="Fecha">{fmtFechaDia(pedido.factura.fecha)}</Fila>
          <Fila label="Total">{pedido.factura.total == null ? null : fmtMoneda(pedido.factura.total)}</Fila>
        </dl>
        {vinculada && (
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            Vinculada {vinculada}. El pedido figura como facturado.
          </p>
        )}
        {reserva}
        <div>
          <Button variant="ghost" onClick={() => setConfirmarDesvincular(true)} disabled={guardando}>
            Desvincular
          </Button>
        </div>

        <Dialog
          open={confirmarDesvincular}
          onOpenChange={(open) => { if (!open && !guardando) setConfirmarDesvincular(false) }}
          title="Desvincular factura"
          description="El pedido dejará de figurar como facturado y, si sigue activo, volverá a reservar stock. La factura no se modifica en Alegra."
          headerBorder={false}
          footer={
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setConfirmarDesvincular(false)} disabled={guardando}>
                Cancelar
              </Button>
              <Button variant="danger" loading={guardando} onClick={() => void desvincular()}>
                Desvincular
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  if (pedido.estado === "cancelado") {
    return (
      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
        Un pedido cancelado no admite una factura vinculada.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          void buscar()
        }}
      >
        <div className="w-full sm:w-72">
          <Field label="Número de factura" hint="Tal como figura en Alegra, por ejemplo 00201-00007040.">
            <Input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              maxLength={60}
              disabled={buscando}
              autoComplete="off"
            />
          </Field>
        </div>
        <Button type="submit" loading={buscando} disabled={!numero.trim()}>
          Buscar
        </Button>
      </form>
      {reserva}

      <Dialog
        open={encontrada !== null}
        onOpenChange={(open) => { if (!open && !guardando) setEncontrada(null) }}
        title="Vincular factura"
        description="Al vincularla, el pedido queda como facturado y se libera el stock reservado. El estado del pedido no cambia."
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setEncontrada(null)} disabled={guardando}>
              Cancelar
            </Button>
            <Button loading={guardando} onClick={() => void vincular()}>
              Vincular
            </Button>
          </div>
        }
      >
        {encontrada && (
          <div className="flex flex-col gap-3">
            <dl className="flex flex-col gap-1">
              <Fila label="Factura">{encontrada.factura.numero ?? `Id ${encontrada.factura.alegraId}`}</Fila>
              <Fila label="Fecha">{fmtFechaDia(encontrada.factura.fecha)}</Fila>
              <Fila label="Total">{fmtMoneda(encontrada.factura.total)}</Fila>
              <Fila label="Cliente">{encontrada.factura.clienteNombre}</Fila>
            </dl>
            {!encontrada.clienteVerificado && (
              <Alert tone="warning" title="Verifique el cliente">
                Este pedido no tiene un cliente de Alegra asociado. Confirme que la factura corresponde a este pedido.
              </Alert>
            )}
            {encontrada.otrosPedidos.length > 0 && (
              <Alert tone="warning" title="Factura ya vinculada">
                Esta factura ya está vinculada {encontrada.otrosPedidos.length === 1 ? "al pedido" : "a los pedidos"}{" "}
                {encontrada.otrosPedidos.join(", ")}.
              </Alert>
            )}
          </div>
        )}
      </Dialog>
    </div>
  )
}
