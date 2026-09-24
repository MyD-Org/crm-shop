"use client";

import { Badge, Table, type TableColumn } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import type { ComprobanteCliente } from "@/lib/comprobantes/repo";
import {
  LABEL_ESTADO_COMPROBANTE,
  TONO_ESTADO_COMPROBANTE,
  fechaCorta,
  medioDe,
  montoDe,
} from "@/lib/comprobantes/vista-comprobantes";
import { CargarMas } from "./CargarMas";

/**
 * "Mis comprobantes" (CMP-4): los comprobantes informados por el cliente que
 * el backoffice ve (`pending` = "En revisión", `loaded` = "Registrado", con el
 * número del pago de Alegra si se registró ahí). Los estados internos nunca
 * llegan acá: la API sólo devuelve los visibles.
 */
export function MisComprobantes({
  items,
  total,
  cargando,
  error,
  onCargarMas,
}: {
  items: ComprobanteCliente[];
  total: number;
  cargando: boolean;
  error: string | null;
  onCargarMas: () => void;
}) {
  const columnas: TableColumn<ComprobanteCliente>[] = [
    { key: "paidOn", header: "Fecha del pago", render: (c) => <span className="text-muted">{fechaCorta(c.paidOn)}</span> },
    {
      key: "submittedAt",
      header: "Informado",
      hideBelow: "md",
      render: (c) => <span className="text-muted">{c.submittedAt ? fechaCorta(c.submittedAt) : "—"}</span>,
    },
    { key: "medio", header: "Medio", hideBelow: "sm", render: (c) => <span className="text-muted">{medioDe(c)}</span> },
    {
      key: "monto",
      header: "Monto",
      align: "right",
      render: (c) => <span className="font-medium tabular-nums text-text">{fmtPrecio(montoDe(c))}</span>,
    },
    {
      key: "estado",
      header: "Estado",
      align: "right",
      render: (c) => (
        <div className="inline-flex flex-col items-end gap-1">
          <Badge tone={TONO_ESTADO_COMPROBANTE[c.status]}>{LABEL_ESTADO_COMPROBANTE[c.status]}</Badge>
          {c.pagoAlegra && <span className="text-xs text-muted">Recibo {c.pagoAlegra}</span>}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <Table<ComprobanteCliente>
        columns={columnas}
        rows={items}
        rowKey={(c) => c.id}
        empty="Todavía no informó comprobantes."
      />
      <CargarMas cantidad={items.length} total={total} cargando={cargando} error={error} onCargarMas={onCargarMas} />
    </div>
  );
}
