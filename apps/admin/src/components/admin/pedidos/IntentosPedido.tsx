import { Badge, Card, Table, type TableColumn } from "@myd-org/ui"
import type { IntentoPedidoDto } from "@/lib/pagos-intentos-repo"
import { ETIQUETA_CLASE, TONO_CLASE, motivoIntento, nombreCuenta, nombreProveedor } from "../pagos-intentos/logica"
import { fmtFechaPedido } from "./format"

interface Props {
  intentos: IntentoPedidoDto[]
  nombresSucursal?: Readonly<Record<string, string>>
}

// Intentos de cobro en línea de un pedido (más nuevo primero). El detalle del pedido es sólo para
// admin y superadmin, así que el error del proveedor (diagnóstico interno) no sale a otros roles.
export function IntentosPedido({ intentos, nombresSucursal = {} }: Props) {
  const nombres = new Map(Object.entries(nombresSucursal))

  const columns: TableColumn<IntentoPedidoDto>[] = [
    {
      key: "estado",
      header: "Estado",
      render: (i) => <Badge tone={TONO_CLASE[i.clase]}>{ETIQUETA_CLASE[i.clase]}</Badge>,
    },
    {
      key: "motivo",
      header: "Motivo",
      render: (i) => {
        const motivo = motivoIntento(i)
        return (
          <span className="text-xs break-words" style={{ color: motivo ? "var(--ink-soft)" : "var(--ink-faint)" }}>
            {motivo ?? "—"}
          </span>
        )
      },
    },
    {
      key: "cuenta",
      header: "Cuenta",
      hideBelow: "sm",
      render: (i) => (
        <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
          {nombreCuenta(i.cuenta ?? i.cuentaPrevista, nombres)}
          {i.cuenta && i.cuentaPrevista && i.cuenta !== i.cuentaPrevista
            ? ` (prevista: ${nombreCuenta(i.cuentaPrevista, nombres)})`
            : ""}
        </span>
      ),
    },
    {
      key: "proveedor",
      header: "Proveedor",
      hideBelow: "sm",
      render: (i) => <span className="text-xs" style={{ color: "var(--ink-soft)" }}>{nombreProveedor(i.proveedor)}</span>,
    },
    {
      key: "fecha",
      header: "Fecha",
      render: (i) => <span className="text-xs tabular-nums" style={{ color: "var(--ink-soft)" }}>{fmtFechaPedido(i.fecha)}</span>,
    },
  ]

  return (
    <Card title="Intentos de pago" className="p-4">
      {intentos.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ink-faint)" }}>Este pedido no registra intentos de pago</p>
      ) : (
        <Table<IntentoPedidoDto> columns={columns} rows={intentos} rowKey={(i) => i.id} />
      )}
    </Card>
  )
}
