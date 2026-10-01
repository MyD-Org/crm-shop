"use client"

import { useState } from "react"
import { Badge, Button, Card } from "@myd-org/ui"
import { ComprobanteDialog } from "@/components/admin/comprobantes/ComprobanteDialog"
import type { ComprobantePedidoDto, CuentaPagoDto, PagoRegistradoDto } from "@/lib/pedidos-repo"
import { fmtFechaDia, fmtFechaPedido, fmtMoneda } from "./format"

// Bloque del detalle del pedido con lo que rodea al pago por transferencia: la cuenta que se le
// informó al comprador (snapshot congelado al crear el pedido), los comprobantes que subió y los
// pagos que registró el equipo (los anulados quedan, marcados). Sin nada de eso, no se muestra.

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs" style={{ color: "var(--ink-faint)" }}>{label}</dt>
      <dd className="text-sm break-words" style={{ color: "var(--ink)" }}>{children || "—"}</dd>
    </div>
  )
}

export function PagosComprobantes({
  pedidoId,
  cuentaPago,
  comprobantes,
  pagos,
  esAdminPlus = false,
  onChanged,
}: {
  pedidoId: string
  cuentaPago: CuentaPagoDto | null
  comprobantes: ComprobantePedidoDto[]
  pagos: PagoRegistradoDto[]
  /** admin+: el popup trae las acciones de Comprobantes; el operador lo ve de sólo lectura. */
  esAdminPlus?: boolean
  /** El popup cambió el comprobante (p. ej. "Ya lo cargué a mano"): refrescar el pedido. */
  onChanged?: () => void
}) {
  const [abierto, setAbierto] = useState<string | null>(null)
  if (!cuentaPago && comprobantes.length === 0 && pagos.length === 0) return null

  return (
    <>
    <Card title="Pagos y comprobantes" className="p-4">
      <div className="flex flex-col gap-4">
        {cuentaPago && (
          <div>
            <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--ink)" }}>Cuenta informada al comprador</h3>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Dato label="Alias">{cuentaPago.alias}</Dato>
              <Dato label="CBU">{cuentaPago.cbu}</Dato>
              <Dato label="Banco">{cuentaPago.banco}</Dato>
              <Dato label="Titular">{cuentaPago.titular}</Dato>
              <Dato label="CUIT">{cuentaPago.cuit}</Dato>
            </dl>
          </div>
        )}

        <div>
          <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--ink)" }}>Comprobantes del comprador</h3>
          {comprobantes.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--ink-faint)" }}>Sin comprobante</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {comprobantes.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                  <span className="tabular-nums">{fmtMoneda(c.monto)}</span>
                  <span style={{ color: "var(--ink-soft)" }}>{fmtFechaDia(c.fecha)}</span>
                  <Badge tone={c.estado === "loaded" ? "success" : "warning"}>
                    {c.estado === "loaded" ? "Ya cargado" : "Por revisar"}
                  </Badge>
                  {c.tieneArchivo && (
                    <Button variant="ghost" size="sm" onClick={() => setAbierto(c.id)}>
                      Ver comprobante
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {pagos.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--ink)" }}>Pagos registrados</h3>
            <ul className="flex flex-col gap-2">
              {pagos.map((p) => (
                <li key={p.id} className="text-sm" style={{ color: p.anulado ? "var(--ink-faint)" : "var(--ink)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={p.anulado ? "tabular-nums line-through" : "tabular-nums"}>{fmtMoneda(p.monto)}</span>
                    <span>{fmtFechaDia(p.fecha)}</span>
                    {p.referencia && <span>Ref. {p.referencia}</span>}
                    {p.anulado && <Badge tone="danger">Anulado</Badge>}
                  </div>
                  <div className="text-xs" style={{ color: "var(--ink-faint)" }}>
                    Registrado por {p.registradoPorNombre ?? "un operador"} el {fmtFechaPedido(p.creadoEn)}
                    {p.anulado ? ` · Anulado por ${p.anulado.porNombre ?? "un operador"} el ${fmtFechaPedido(p.anulado.en)}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
      {abierto && (
        <ComprobanteDialog
          id={abierto}
          initial={null}
          pedidoId={esAdminPlus ? undefined : pedidoId}
          soloLectura={!esAdminPlus}
          onClose={() => setAbierto(null)}
          onChanged={() => onChanged?.()}
        />
      )}
    </>
  )
}
