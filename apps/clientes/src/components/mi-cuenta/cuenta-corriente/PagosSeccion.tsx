"use client";

import { useState } from "react";
import { Badge, Button, EmptyState, Table, type TableColumn } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import { PAGOS_CAIDOS } from "@/lib/cuenta-corriente/mensajes";
import type { Pago } from "@/lib/cuenta-corriente/tipos";
import { urlDocumento, type DocumentoAbierto } from "@/lib/cuenta-corriente/vista-facturas";
import { resumenImputaciones } from "@/lib/cuenta-corriente/vista-presupuestos";
import type { ContactoWhatsApp } from "@/lib/cuenta-corriente/whatsapp";
import { IconoDescarga, IconoOjo, IconoPago } from "../iconos";
import { CargarMas } from "./CargarMas";
import { PagoDetalle } from "./PagoDetalle";
import { usePaginaApi } from "./usePaginaApi";
import { VisorDocumento } from "./VisorDocumento";
import { WhatsAppPagos } from "./WhatsAppPagos";

/**
 * Pagos recibidos (PAG-1): primera página del servidor y "Cargar más" contra
 * `GET /api/mi-cuenta/pagos`, de a 10. Sin filtros, búsqueda ni orden por
 * columna, como el portal: Alegra no filtra pagos por fecha y ordenar miraría
 * sólo lo cargado. Cada pago abre su detalle con las imputaciones (PAG-2) y su
 * PDF en el visor de la página.
 */
export function PagosSeccion({
  primeraPagina,
  whatsapp,
}: {
  primeraPagina: { pagos: Pago[]; total: number };
  whatsapp: ContactoWhatsApp | null;
}) {
  const pagina = usePaginaApi<Pago>({
    ruta: "/api/mi-cuenta/pagos",
    campo: "pagos",
    inicial: { items: primeraPagina.pagos, total: primeraPagina.total },
    errorCarga: PAGOS_CAIDOS,
  });
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [detalle, setDetalle] = useState<Pago | null>(null);
  const [visor, setVisor] = useState<DocumentoAbierto | null>(null);

  const verPdf = (p: Pago) => setVisor({ kind: "pago", alegraId: p.alegraId, titulo: `Recibo ${p.id}` });
  const seleccionados = pagina.items.filter((p) => seleccion.includes(p.alegraId));

  const columnas: TableColumn<Pago>[] = [
    {
      key: "id",
      header: "Recibo",
      render: (p) => <span className="font-medium text-text">{p.id}</span>,
    },
    { key: "fecha", header: "Fecha", render: (p) => <span className="text-muted">{p.fecha}</span> },
    {
      key: "facturas",
      header: "Facturas",
      hideBelow: "md",
      render: (p) => {
        const { primera, mas } = resumenImputaciones(p);
        return (
          <span className="inline-flex items-center gap-2 text-muted">
            {primera}
            {mas > 0 && <Badge tone="info">+{mas}</Badge>}
          </span>
        );
      },
    },
    { key: "medio", header: "Medio", hideBelow: "sm", render: (p) => <span className="text-muted">{p.medio || "—"}</span> },
    {
      key: "monto",
      header: "Monto",
      align: "right",
      render: (p) => <span className="font-medium tabular-nums text-text">{fmtPrecio(p.monto)}</span>,
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      render: (p) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={`Ver detalle del recibo ${p.id}`} onClick={() => setDetalle(p)}>
            <IconoPago size={16} />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Ver recibo ${p.id}`} onClick={() => verPdf(p)}>
            <IconoOjo />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Descargar recibo ${p.id}`}
            href={urlDocumento("pago", p.alegraId, true)}
          >
            <IconoDescarga />
          </Button>
        </div>
      ),
    },
  ];

  if (primeraPagina.total === 0) {
    return <EmptyState title="Todavía no tiene pagos registrados." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {whatsapp && (
        <WhatsAppPagos contacto={whatsapp} seleccionados={seleccionados} onLimpiar={() => setSeleccion([])} />
      )}

      <Table<Pago>
        columns={columnas}
        rows={pagina.items}
        rowKey={(p) => p.alegraId}
        selectable={!!whatsapp}
        selectedKeys={seleccion}
        onSelectionChange={setSeleccion}
        empty="No hay pagos para mostrar."
      />

      <CargarMas
        cantidad={pagina.items.length}
        total={pagina.total}
        cargando={pagina.cargando}
        error={pagina.error}
        onCargarMas={pagina.cargarMas}
      />

      <PagoDetalle
        pago={detalle}
        onClose={() => setDetalle(null)}
        onVerPdf={(p) => {
          setDetalle(null);
          verPdf(p);
        }}
      />
      <VisorDocumento doc={visor} onClose={() => setVisor(null)} />
    </div>
  );
}
