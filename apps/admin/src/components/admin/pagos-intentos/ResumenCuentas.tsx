"use client"

import { Table, type TableColumn } from "@myd-org/ui"
import type { ResumenCuentaDto } from "@/lib/pagos-intentos-repo"
import { fmtTasa, nombreCuenta, nombreProveedor } from "./logica"

interface Props {
  cuentas: ResumenCuentaDto[]
  offline: { transferencia: number; efectivo: number }
  nombresCuenta: ReadonlyMap<string, string>
}

const num = (n: number) => <span className="tabular-nums">{n}</span>

// Tabla de resumen proveedor × cuenta. La tasa de fallo = fallos / (fallos + aprobados): los
// intentos "en curso" no entran. Transferencia y efectivo se informan aparte, fuera de la tasa.
export function ResumenCuentas({ cuentas, offline, nombresCuenta }: Props) {
  const columns: TableColumn<ResumenCuentaDto>[] = [
    {
      key: "proveedor",
      header: "Medio y cuenta",
      render: (r) => (
        <>
          <div className="font-medium" style={{ color: "var(--ink)" }}>{nombreProveedor(r.proveedor)}</div>
          <div className="text-xs" style={{ color: "var(--ink-faint)" }}>{nombreCuenta(r.cuenta, nombresCuenta)}</div>
        </>
      ),
    },
    { key: "aprobados", header: "Aprobados", align: "right", render: (r) => num(r.aprobados) },
    { key: "rechazo", header: "Rechazo del banco", align: "right", hideBelow: "md", render: (r) => num(r.rechazoBanco) },
    { key: "error", header: "Error del proveedor", align: "right", render: (r) => num(r.errorProveedor) },
    { key: "cred", header: "Credenciales rechazadas", align: "right", hideBelow: "lg", render: (r) => num(r.credenciales) },
    { key: "reserva", header: "Reserva abandonada", align: "right", hideBelow: "lg", render: (r) => num(r.reservaAbandonada) },
    { key: "curso", header: "En curso", align: "right", hideBelow: "md", render: (r) => num(r.pendientes) },
    {
      key: "tasa",
      header: "Tasa de fallo",
      align: "right",
      className: "font-medium",
      render: (r) => <span className="tabular-nums" style={{ color: "var(--ink)" }}>{fmtTasa(r.tasaFallo)}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-2">
      <Table<ResumenCuentaDto>
        columns={columns}
        rows={cuentas}
        rowKey={(r) => `${r.proveedor}/${r.cuenta}`}
        empty="No hay intentos de pago en el período"
      />
      <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
        La tasa de fallo no cuenta los intentos en curso. En el período hubo {offline.transferencia}{" "}
        {offline.transferencia === 1 ? "pedido" : "pedidos"} por transferencia y {offline.efectivo}{" "}
        {offline.efectivo === 1 ? "pedido" : "pedidos"} en efectivo, que no pasan por un procesador y no integran la tasa.
      </p>
    </div>
  )
}
