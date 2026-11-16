"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Alert, Badge, Button, Card, Dialog, Table, type TableColumn } from "@myd-org/ui"
import { accionesDeCompra, AVISO_COSTO_PROMEDIO, estadoCompra, formatoFecha, formatoPesos } from "@/lib/compras-formato"

// Detalle de una compra: datos de la factura, avance por producto y acciones según el estado.
// Editar y Anular sólo están disponibles mientras la compra está pendiente y sin mercadería recibida;
// anular pide confirmación y escribe en Alegra (borra la factura).

interface ItemDto {
  id: string
  codigo: string | null
  nombre: string
  cantidadPedida: string
  cantidadRecibida: string
  costoUnitarioCentavos: number
  ivaPorcentaje: string
}

export interface CompraDetalleDto {
  id: string
  proveedorNombre: string
  numeroFactura: string
  fecha: string
  vencimiento: string
  estado: string
  observaciones: string | null
  desincronizada: boolean
  netoCentavos: number
  ivaCentavos: number
  percepcionesCentavos: number
  totalCentavos: number
  items: ItemDto[]
  percepciones: { nombre: string; importeCentavos: number; numeroCertificado: string | null }[]
  recepciones: number
}

const num = (s: string) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(Number(s))

export function CompraDetalle({
  compra,
  cuentaNombre,
  edicionHabilitada,
}: {
  compra: CompraDetalleDto
  cuentaNombre: string
  edicionHabilitada: boolean
}) {
  const router = useRouter()
  const estado = estadoCompra(compra.estado)
  const acciones = accionesDeCompra(compra.estado, compra.recepciones > 0)
  const [anulando, setAnulando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function anular() {
    setEnviando(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/compras/${compra.id}`, { method: "DELETE" })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setAnulando(false)
        setError(json?.error ?? "No se pudo anular la compra. Inténtelo nuevamente.")
        return
      }
      setAnulando(false)
      router.refresh()
    } catch {
      setAnulando(false)
      setError("Error de conexión. Inténtelo nuevamente.")
    } finally {
      setEnviando(false)
    }
  }

  const columnas: TableColumn<ItemDto>[] = [
    { key: "producto", header: "Producto", render: (i) => (
      <span>
        {i.nombre}
        {i.codigo && <span className="block text-xs" style={{ color: "var(--ink-soft)" }}>{i.codigo}</span>}
      </span>
    ) },
    { key: "pedida", header: "Pedida", align: "right", render: (i) => num(i.cantidadPedida) },
    { key: "recibida", header: "Recibida", align: "right", render: (i) => num(i.cantidadRecibida) },
    { key: "costo", header: "Costo neto", align: "right", hideBelow: "sm", render: (i) => formatoPesos(i.costoUnitarioCentavos) },
    { key: "iva", header: "IVA", align: "right", hideBelow: "md", render: (i) => `${num(i.ivaPorcentaje)} %` },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 pl-10 md:pl-0">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>
            {compra.proveedorNombre} · factura {compra.numeroFactura}
          </h1>
          <p className="mt-0.5 flex items-center gap-2 text-sm" style={{ color: "var(--ink-soft)" }}>
            <Badge tone={estado.tono}>{estado.etiqueta}</Badge>
            <span>{cuentaNombre}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" href="/admin/compras">
            Volver
          </Button>
          {acciones.editar && edicionHabilitada && (
            <Button variant="secondary" href={`/admin/compras/${compra.id}/editar`}>
              Editar
            </Button>
          )}
          {acciones.anular && (
            <Button variant="danger" onClick={() => setAnulando(true)}>
              Anular compra
            </Button>
          )}
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {compra.estado === "creando" && (
        <Alert tone="warning" title="Verificando con Alegra">
          No pudimos confirmar con Alegra que la factura se registró. Esta página lo comprueba cada vez que se abre: vuelva a
          intentarlo en unos minutos y no cargue la compra de nuevo.
        </Alert>
      )}
      {compra.desincronizada && (
        <Alert tone="warning" title="La compra no coincide con Alegra">
          La factura se modificó en Alegra o un cambio no pudo confirmarse. Revísela en Alegra antes de continuar.
        </Alert>
      )}
      {compra.estado === "anulada_en_alegra" && (
        <Alert tone="danger">La factura ya no existe en Alegra. Esta compra no admite más acciones.</Alert>
      )}
      <Alert tone="neutral">{AVISO_COSTO_PROMEDIO}</Alert>

      <Card title="Factura">
        <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-3">
          <div><dt style={{ color: "var(--ink-soft)" }}>Fecha</dt><dd>{formatoFecha(compra.fecha)}</dd></div>
          <div><dt style={{ color: "var(--ink-soft)" }}>Vencimiento</dt><dd>{formatoFecha(compra.vencimiento)}</dd></div>
          <div><dt style={{ color: "var(--ink-soft)" }}>Observaciones</dt><dd>{compra.observaciones ?? "—"}</dd></div>
        </dl>
      </Card>

      <Card title="Productos">
        <Table columns={columnas} rows={compra.items} rowKey={(i) => i.id} />
      </Card>

      {compra.percepciones.length > 0 && (
        <Card title="Percepciones">
          <ul className="flex flex-col gap-1 text-sm">
            {compra.percepciones.map((p) => (
              <li key={p.nombre} className="flex justify-between gap-4">
                <span>
                  {p.nombre}
                  {p.numeroCertificado && <span style={{ color: "var(--ink-soft)" }}> · certificado {p.numeroCertificado}</span>}
                </span>
                <span>{formatoPesos(p.importeCentavos)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <dl className="ml-auto grid w-fit grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
          <dt style={{ color: "var(--ink-soft)" }}>Neto</dt><dd className="text-right">{formatoPesos(compra.netoCentavos)}</dd>
          <dt style={{ color: "var(--ink-soft)" }}>IVA</dt><dd className="text-right">{formatoPesos(compra.ivaCentavos)}</dd>
          <dt style={{ color: "var(--ink-soft)" }}>Percepciones</dt><dd className="text-right">{formatoPesos(compra.percepcionesCentavos)}</dd>
          <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{formatoPesos(compra.totalCentavos)}</dd>
        </dl>
      </Card>

      <Dialog
        open={anulando}
        onOpenChange={(o) => !enviando && setAnulando(o)}
        title="Anular compra"
        description="Se eliminará la factura de compra en Alegra y la mercadería dejará de estar en tránsito. Esta acción no se puede deshacer."
        dismissible={!enviando}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAnulando(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={anular} loading={enviando}>
              Anular compra
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {compra.proveedorNombre} · factura {compra.numeroFactura} · {formatoPesos(compra.totalCentavos)}
        </p>
      </Dialog>
    </div>
  )
}
