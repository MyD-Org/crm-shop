"use client"

import { useRouter } from "next/navigation"
import { Badge, EmptyState, Table, type TableColumn } from "@myd-org/ui"
import { estadoCompra, formatoFecha, formatoPesos } from "@/lib/compras-formato"

// Listado básico de compras: cuenta, proveedor, factura, fecha, estado y total. Al hacer clic en una
// fila se abre el detalle. (Filtros y paginación llegan en una rebanada posterior.)

export interface CompraListaItem {
  id: string
  cuentaId: string
  proveedorNombre: string
  numeroFactura: string
  fecha: string
  estado: string
  totalCentavos: number
}

export function ComprasLista({
  compras,
  cuentas,
}: {
  compras: CompraListaItem[]
  cuentas: { id: string; nombre: string }[]
}) {
  const router = useRouter()
  const nombreCuenta = (id: string) => cuentas.find((c) => c.id === id)?.nombre ?? "—"

  const columnas: TableColumn<CompraListaItem>[] = [
    { key: "fecha", header: "Fecha", render: (c) => formatoFecha(c.fecha) },
    { key: "proveedor", header: "Proveedor", render: (c) => c.proveedorNombre },
    { key: "numero", header: "Factura", render: (c) => c.numeroFactura, hideBelow: "sm" },
    { key: "cuenta", header: "Cuenta", render: (c) => nombreCuenta(c.cuentaId), hideBelow: "md" },
    {
      key: "estado",
      header: "Estado",
      render: (c) => {
        const e = estadoCompra(c.estado)
        return <Badge tone={e.tono}>{e.etiqueta}</Badge>
      },
    },
    { key: "total", header: "Total", align: "right", render: (c) => formatoPesos(c.totalCentavos) },
  ]

  return (
    <Table
      columns={columnas}
      rows={compras}
      rowKey={(c) => c.id}
      onRowClick={(c) => router.push(`/admin/compras/${c.id}`)}
      empty={
        <EmptyState
          title="Todavía no hay compras"
          description="Registre la primera factura de un proveedor con el botón «Nueva compra»."
        />
      }
    />
  )
}
