"use client"

import { useState } from "react"
import { Alert, Button, Dialog, DocumentViewer, Field, Input, useToast } from "@myd-org/ui"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { fmtCantidad, fmtFechaDia } from "./format"
import { interpretarRespuestaFactura } from "./logica"

// "Remito" del detalle de pedido (rebanada D): remito único e íntegro por pedido, sin entregas
// parciales. Reusa `interpretarRespuestaFactura` (lib genérica pese al nombre: sólo interpreta
// status/mensaje de una respuesta con el mismo shape de error que "factura") para no duplicar
// esa lógica. Sólo admin+ la ve: el servidor exige `requireAdminPlus` en las tres rutas.

interface RemisionEncontrada {
  remision: { alegraId: string; numero: string | null; fecha: string; clienteNombre: string | null }
  clienteVerificado: boolean
}

interface PreviewRemito {
  lineas: { alegraItemId: string; nombre: string; cantidad: number }[]
  avisos: string[]
}

interface Props {
  pedido: PedidoDetalleDto
  onChanged: (pedido: PedidoDetalleDto) => void
  onConflicto: () => void
  esAdminPlus: boolean
}

const esDetalle = (b: unknown) => typeof (b as { id?: unknown }).id === "string"
const esEncontrada = (b: unknown) => typeof (b as RemisionEncontrada).remision?.alegraId === "string"
const esPreview = (b: unknown) => Array.isArray((b as PreviewRemito)?.lineas)

export function RemitoControl({ pedido, onChanged, onConflicto, esAdminPlus }: Props) {
  const { toast } = useToast()
  const base = `/api/admin/pedidos/${pedido.id}/remito`

  // Vincular remito existente
  const [numero, setNumero] = useState("")
  const [verBuscar, setVerBuscar] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [encontrada, setEncontrada] = useState<RemisionEncontrada | null>(null)
  const [vinculando, setVinculando] = useState(false)

  // Emitir remito
  const [emitirAbierto, setEmitirAbierto] = useState(false)
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [preview, setPreview] = useState<PreviewRemito | null>(null)
  const [errorPreview, setErrorPreview] = useState<string | null>(null)
  const [emitiendo, setEmitiendo] = useState(false)

  // Desvincular
  const [confirmarDesvincular, setConfirmarDesvincular] = useState(false)
  const [desvinculando, setDesvinculando] = useState(false)

  // Ver PDF
  const [verPdf, setVerPdf] = useState(false)

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
    const r = interpretarRespuestaFactura<RemisionEncontrada>(status, body, esEncontrada)
    if (r.tipo === "ok") {
      setEncontrada(r.valor)
      return
    }
    toast({ title: r.mensaje, tone: "danger" })
    if (r.tipo === "conflicto") onConflicto()
  }

  async function vincular() {
    if (!encontrada) return
    setVinculando(true)
    const { status, body } = await llamar(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alegraId: encontrada.remision.alegraId }),
    })
    setVinculando(false)
    const r = interpretarRespuestaFactura<PedidoDetalleDto>(status, body, esDetalle)
    if (r.tipo === "ok") {
      setEncontrada(null)
      setNumero("")
      toast({ title: "El remito quedó vinculado al pedido.", tone: "success" })
      onChanged(r.valor)
      return
    }
    toast({ title: r.mensaje, tone: "danger" })
    if (r.tipo === "conflicto") {
      setEncontrada(null)
      onConflicto()
    }
  }

  async function abrirEmitir() {
    setEmitirAbierto(true)
    setCargandoPreview(true)
    setErrorPreview(null)
    setPreview(null)
    const { status, body } = await llamar(`${base}/emitir`)
    setCargandoPreview(false)
    const r = interpretarRespuestaFactura<PreviewRemito>(status, body, esPreview)
    if (r.tipo === "ok") {
      setPreview(r.valor)
      return
    }
    setErrorPreview(r.mensaje)
    if (r.tipo === "conflicto") onConflicto()
  }

  function cerrarEmitir() {
    if (emitiendo) return
    setEmitirAbierto(false)
    setPreview(null)
    setErrorPreview(null)
  }

  async function emitir() {
    if (!preview || preview.avisos.length > 0) return
    setEmitiendo(true)
    const { status, body } = await llamar(`${base}/emitir`, { method: "POST" })
    setEmitiendo(false)
    const r = interpretarRespuestaFactura<PedidoDetalleDto>(status, body, esDetalle)
    if (r.tipo === "ok") {
      toast({ title: `Remito ${r.valor.remito?.numero ?? ""} emitido.`.replace("  ", " "), tone: "success" })
      onChanged(r.valor)
      cerrarEmitir()
      return
    }
    toast({ title: r.mensaje, tone: "danger" })
    if (r.tipo === "conflicto") {
      cerrarEmitir()
      onConflicto()
    }
  }

  async function desvincular() {
    setDesvinculando(true)
    const { status, body } = await llamar(base, { method: "DELETE" })
    setDesvinculando(false)
    setConfirmarDesvincular(false)
    const r = interpretarRespuestaFactura<PedidoDetalleDto>(status, body, esDetalle)
    if (r.tipo === "ok") {
      toast({ title: "El remito se desvinculó del pedido.", tone: "success" })
      onChanged(r.valor)
      return
    }
    toast({ title: r.mensaje, tone: "danger" })
    if (r.tipo === "conflicto") onConflicto()
  }

  if (!esAdminPlus) return null

  if (pedido.remito) {
    return (
      <div className="flex flex-col gap-3">
        <dl className="flex max-w-sm flex-col gap-1">
          <div className="flex justify-between gap-3 text-sm">
            <dt style={{ color: "var(--ink-soft)" }}>Remito</dt>
            <dd className="text-right" style={{ color: "var(--ink)" }}>
              {pedido.remito.numero ?? `Id ${pedido.remito.alegraId} en Alegra`}
            </dd>
          </div>
          <div className="flex justify-between gap-3 text-sm">
            <dt style={{ color: "var(--ink-soft)" }}>Fecha</dt>
            <dd className="text-right" style={{ color: "var(--ink)" }}>{fmtFechaDia(pedido.remito.fecha)}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setVerPdf(true)}>
            Ver PDF
          </Button>
          <Button variant="ghost" onClick={() => setConfirmarDesvincular(true)} disabled={desvinculando}>
            Desvincular
          </Button>
        </div>

        <DocumentViewer
          open={verPdf}
          onOpenChange={setVerPdf}
          title={`Remito ${pedido.remito.numero ?? pedido.remito.alegraId}`}
          src={`${base}/pdf`}
          downloadHref={`${base}/pdf?download=1`}
          hint={null}
        />

        <Dialog
          open={confirmarDesvincular}
          onOpenChange={(open) => { if (!open && !desvinculando) setConfirmarDesvincular(false) }}
          title="Desvincular remito"
          description="El pedido dejará de figurar con remito. El documento no se modifica en Alegra."
          headerBorder={false}
          footer={
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setConfirmarDesvincular(false)} disabled={desvinculando}>
                Cancelar
              </Button>
              <Button variant="danger" loading={desvinculando} onClick={() => void desvincular()}>
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
        Un pedido cancelado no admite un remito.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => void abrirEmitir()}>
          Emitir remito
        </Button>
      </div>

      {!verBuscar && (
        <Button
          variant="link"
          size="sm"
          className="self-start"
          aria-expanded={false}
          onClick={() => setVerBuscar(true)}
        >
          Vincular uno existente
        </Button>
      )}
      {verBuscar && <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          void buscar()
        }}
      >
        <div className="w-full sm:w-72">
          <Field
            label="Número o enlace del remito existente"
            hint="Tal como figura en Alegra, o el enlace al remito."
          >
            <Input value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={60} disabled={buscando} autoComplete="off" />
          </Field>
        </div>
        <Button type="submit" loading={buscando} disabled={!numero.trim()}>
          Buscar
        </Button>
      </form>}

      <Dialog
        open={encontrada !== null}
        onOpenChange={(open) => { if (!open && !vinculando) setEncontrada(null) }}
        title="Vincular remito"
        description="El remito ya existe en Alegra; sólo se asocia al pedido."
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setEncontrada(null)} disabled={vinculando}>
              Cancelar
            </Button>
            <Button loading={vinculando} onClick={() => void vincular()}>
              Vincular
            </Button>
          </div>
        }
      >
        {encontrada && (
          <div className="flex flex-col gap-3">
            <div className="flex justify-between gap-3 text-sm">
              <span style={{ color: "var(--ink-soft)" }}>Remito</span>
              <span style={{ color: "var(--ink)" }}>{encontrada.remision.numero ?? `Id ${encontrada.remision.alegraId}`}</span>
            </div>
            <div className="flex justify-between gap-3 text-sm">
              <span style={{ color: "var(--ink-soft)" }}>Fecha</span>
              <span style={{ color: "var(--ink)" }}>{fmtFechaDia(encontrada.remision.fecha)}</span>
            </div>
            {!encontrada.clienteVerificado && (
              <Alert tone="warning" title="Verifique el cliente">
                Confirme que el remito corresponde a este pedido.
              </Alert>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={emitirAbierto}
        onOpenChange={(open) => { if (!open) cerrarEmitir() }}
        title="Emitir remito"
        description="Crea el remito en Alegra con todos los ítems del pedido, sin importe (es un papel de depósito, no una venta)."
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={cerrarEmitir} disabled={emitiendo}>
              Cancelar
            </Button>
            <Button loading={emitiendo} disabled={!preview || preview.avisos.length > 0} onClick={() => void emitir()}>
              Emitir remito
            </Button>
          </div>
        }
      >
        {cargandoPreview && (
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>Preparando la vista previa…</p>
        )}
        {errorPreview && (
          <Alert tone="danger" title="No se pudo preparar la emisión">
            {errorPreview}
          </Alert>
        )}
        {preview && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 rounded border p-2" style={{ borderColor: "var(--border)" }}>
              {preview.lineas.map((l) => (
                <div key={l.alegraItemId} className="flex justify-between gap-3 text-sm">
                  <span style={{ color: "var(--ink)" }}>{l.nombre}</span>
                  <span className="tabular-nums" style={{ color: "var(--ink-soft)" }}>{fmtCantidad(l.cantidad)}</span>
                </div>
              ))}
            </div>
            {preview.avisos.map((a) => (
              <Alert key={a} tone="danger" title="No se puede emitir">
                {a}
              </Alert>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  )
}
