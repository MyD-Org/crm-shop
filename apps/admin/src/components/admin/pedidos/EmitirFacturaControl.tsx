"use client"

import { useState } from "react"
import { Alert, Button, Dialog, Field, Select, useToast } from "@myd-org/ui"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { fmtCantidad, fmtMoneda } from "./format"
import { interpretarRespuestaFactura, separarAvisoFactura, mensajeAvisoFactura } from "./logica"

// "Emitir factura": crea la factura REAL en Alegra desde el pedido (dinero real e irreversible),
// a diferencia de "Vincular factura" (que sólo vincula una ya emitida a mano por fuera). Sólo
// admin+ la ve: el GET/POST del servidor exige `requireAdminPlus` y le contesta 404 a un
// operator, así que ni vale la pena ofrecerle el botón. El preview (GET) es obligatorio: se pide
// siempre al abrir el diálogo, nunca se confía en datos de una apertura anterior.

interface Numeracion {
  alegraId: string
  name: string
  prefix: string | null
  subDocumentType: string
  status: string
}

interface Aviso {
  motivo: string
  detalle: string
}

interface PreviewEmision {
  lineas: { alegraItemId: string; nombre: string; cantidad: number; precioUnitario: number; ivaPorcentaje: number }[]
  total: number
  totalPedido: number
  numeraciones: Numeracion[]
  numeracionSugeridaId: string | null
  contacto: { alegraId: string | null; esNuevo: boolean; nombre: string }
  bloqueo: Aviso | null
  avisos: Aviso[]
}

interface Props {
  pedido: PedidoDetalleDto
  onChanged: (pedido: PedidoDetalleDto) => void
  /** 409: otro operador lo cambió (o ya lo facturó); hay que volver a pedir el pedido. */
  onConflicto: () => void
  /** Sólo admin/superadmin pueden emitir. Un operator ni ve el botón (el servidor le daría 404). */
  esAdminPlus: boolean
}

const esPreview = (b: unknown): b is PreviewEmision => Array.isArray((b as PreviewEmision)?.lineas)
const esDetalle = (b: unknown) => typeof (b as { id?: unknown }).id === "string"

function etiquetaNumeracion(n: Numeracion): string {
  const tipo = n.subDocumentType.replace("INVOICE_", "")
  const prefijo = n.prefix ? ` (${n.prefix})` : ""
  return `${n.name || `Tipo ${tipo}`}${prefijo}`
}

function Fila({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt style={{ color: "var(--ink-soft)" }}>{label}</dt>
      <dd className="text-right tabular-nums" style={{ color: "var(--ink)" }}>{children || "—"}</dd>
    </div>
  )
}

export function EmitirFacturaControl({ pedido, onChanged, onConflicto, esAdminPlus }: Props) {
  const { toast } = useToast()
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [preview, setPreview] = useState<PreviewEmision | null>(null)
  const [numeracionId, setNumeracionId] = useState("")
  const [emitiendo, setEmitiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const base = `/api/admin/pedidos/${pedido.id}/factura/emitir`

  async function llamar(init?: RequestInit) {
    const res = await fetch(base, { cache: "no-store", ...init }).catch(() => null)
    const body: unknown = res ? await res.json().catch(() => null) : null
    return { status: res?.status ?? null, body }
  }

  async function abrir() {
    setAbierto(true)
    setCargando(true)
    setError(null)
    setPreview(null)
    const { status, body } = await llamar()
    setCargando(false)
    const r = interpretarRespuestaFactura<PreviewEmision>(status, body, esPreview)
    if (r.tipo === "ok") {
      setPreview(r.valor)
      setNumeracionId(r.valor.numeracionSugeridaId ?? "")
      return
    }
    setError(r.mensaje)
    if (r.tipo === "conflicto") onConflicto()
  }

  function cerrar() {
    if (emitiendo) return
    setAbierto(false)
    setPreview(null)
    setNumeracionId("")
    setError(null)
  }

  const numeracionSeleccionada = preview?.numeraciones.find((n) => n.alegraId === numeracionId) ?? null
  const bloqueadoPorIva = !!preview?.bloqueo && numeracionSeleccionada?.subDocumentType !== "INVOICE_X"
  const hayAvisos = (preview?.avisos.length ?? 0) > 0
  const puedeConfirmar = !!preview && !!numeracionId && !bloqueadoPorIva && !hayAvisos

  async function emitir() {
    if (!puedeConfirmar) return
    setEmitiendo(true)
    const { status, body } = await llamar({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numberTemplateId: numeracionId }),
    })
    setEmitiendo(false)
    const r = interpretarRespuestaFactura<PedidoDetalleDto>(status, body, esDetalle)
    if (r.tipo === "ok") {
      const { detalle, aviso } = separarAvisoFactura(r.valor)
      const mail = aviso ? mensajeAvisoFactura(aviso) : null
      toast({
        title: `Factura ${detalle.factura?.numero ?? ""} emitida.`.replace("  ", " "),
        description: mail?.texto,
        tone: mail && !mail.ok ? "warning" : "success",
      })
      onChanged(detalle)
      cerrar()
      return
    }
    toast({ title: r.mensaje, tone: "danger" })
    if (r.tipo === "conflicto") {
      cerrar()
      onConflicto()
    }
  }

  if (!esAdminPlus) return null

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <Button variant="ghost" size="sm" onClick={() => void abrir()}>
        Emitir factura
      </Button>
      <p className="mt-1 text-xs" style={{ color: "var(--ink-faint)" }}>
        Crea el comprobante real en Alegra. Para facturas hechas por fuera, use &ldquo;Vincular factura&rdquo; arriba.
      </p>

      <Dialog
        open={abierto}
        onOpenChange={(open) => { if (!open) cerrar() }}
        title="Emitir factura"
        description='Esta acción crea el comprobante en Alegra y no se puede deshacer: para anularlo hace falta una nota de crédito.'
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={cerrar} disabled={emitiendo}>
              Cancelar
            </Button>
            <Button loading={emitiendo} disabled={!puedeConfirmar} onClick={() => void emitir()}>
              Emitir factura
            </Button>
          </div>
        }
      >
        {cargando && (
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            Preparando la vista previa…
          </p>
        )}
        {error && (
          <Alert tone="danger" title="No se pudo preparar la emisión">
            {error}
          </Alert>
        )}
        {preview && (
          <div className="flex flex-col gap-4">
            <Field label="Tipo de comprobante">
              <Select
                value={numeracionId}
                onValueChange={setNumeracionId}
                options={preview.numeraciones.map((n) => ({ value: n.alegraId, label: etiquetaNumeracion(n) }))}
                placeholder="Seleccione…"
                disabled={emitiendo}
              />
            </Field>

            <dl className="flex flex-col gap-1">
              <Fila label="Cliente">
                {preview.contacto.nombre}
                {preview.contacto.esNuevo ? " (se crea en Alegra)" : ""}
              </Fila>
            </dl>

            <div className="flex flex-col gap-1 rounded border p-2" style={{ borderColor: "var(--border)" }}>
              {preview.lineas.map((l) => (
                <div key={l.alegraItemId} className="flex justify-between gap-3 text-sm">
                  <span style={{ color: "var(--ink)" }}>
                    {fmtCantidad(l.cantidad)} × {l.nombre} ({fmtCantidad(l.ivaPorcentaje)}% IVA)
                  </span>
                  <span className="tabular-nums" style={{ color: "var(--ink-soft)" }}>
                    {fmtMoneda(l.precioUnitario * l.cantidad)}
                  </span>
                </div>
              ))}
            </div>

            <dl className="flex flex-col gap-1">
              <Fila label="Total a facturar">{fmtMoneda(preview.total)}</Fila>
              <Fila label="Total del pedido (sin envío)">{fmtMoneda(preview.totalPedido)}</Fila>
            </dl>

            {preview.avisos.map((a) => (
              <Alert key={a.motivo} tone="danger" title="No se puede emitir">
                {a.detalle}
              </Alert>
            ))}

            {bloqueadoPorIva && preview.bloqueo && (
              <Alert tone="danger" title="No se puede emitir">
                {preview.bloqueo.detalle}
              </Alert>
            )}

            <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
              Emitir crea el comprobante en Alegra y no se puede deshacer: para anularlo hace falta una nota de
              crédito.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  )
}
