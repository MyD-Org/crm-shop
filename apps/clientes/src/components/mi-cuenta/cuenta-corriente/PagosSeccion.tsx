"use client";

import { useState } from "react";
import { Badge, Button, EmptyState, Table, type TableColumn } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import type { ComprobanteCliente } from "@/lib/comprobantes/repo";
import { PAGOS_CAIDOS } from "@/lib/cuenta-corriente/mensajes";
import type { Pago } from "@/lib/cuenta-corriente/tipos";
import { urlDocumento, type DocumentoAbierto } from "@/lib/cuenta-corriente/vista-facturas";
import { datosFila, filasPagos, type FilaPago } from "@/lib/cuenta-corriente/vista-pagos";
import { resumenImputaciones } from "@/lib/cuenta-corriente/vista-presupuestos";
import type { ContactoWhatsApp } from "@/lib/cuenta-corriente/whatsapp";
import { IconoDescarga, IconoOjo, IconoPago } from "../iconos";
import { CargarMas } from "./CargarMas";
import { PagoDetalle } from "./PagoDetalle";
import { usePaginaApi } from "./usePaginaApi";
import { VisorDocumento } from "./VisorDocumento";
import { WhatsAppPagos } from "./WhatsAppPagos";

/**
 * Pagos en una sola tabla: arriba los que informó el cliente y todavía están en
 * revisión; debajo los recibos de Alegra (PAG-1), con primera página del
 * servidor y "Cargar más" contra `GET /api/mi-cuenta/pagos`, de a 10. Sin
 * filtros, búsqueda ni orden por columna, como el portal: Alegra no filtra
 * pagos por fecha y ordenar miraría sólo lo cargado. Cada recibo abre su
 * detalle con las imputaciones (PAG-2) y su PDF en el visor de la página.
 * Toda fila se puede seleccionar para consultarla por WhatsApp.
 */
export function PagosSeccion({
  primeraPagina,
  informados,
  whatsapp,
}: {
  primeraPagina: { pagos: Pago[]; total: number };
  /** Comprobantes informados por el cliente (los ya registrados se descartan). */
  informados: ComprobanteCliente[];
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
  const filas = filasPagos(informados, pagina.items);
  const seleccionados = filas.filter((f) => seleccion.includes(f.clave)).map(datosFila);

  const columnas: TableColumn<FilaPago>[] = [
    { key: "fecha", header: "Fecha", render: (f) => <span className="text-muted">{datosFila(f).fecha}</span> },
    {
      key: "pago",
      header: "Pago",
      render: (f) =>
        f.tipo === "recibo" ? (
          <span className="font-medium text-text">Recibo {f.pago.id}</span>
        ) : (
          <span className="text-text">Informado por usted</span>
        ),
    },
    {
      key: "facturas",
      header: "Facturas",
      hideBelow: "md",
      render: (f) => {
        if (f.tipo === "informado") return <span className="text-muted">—</span>;
        const { primera, mas } = resumenImputaciones(f.pago);
        return (
          <span className="inline-flex items-center gap-2 text-muted">
            {primera}
            {mas > 0 && <Badge tone="info">+{mas}</Badge>}
          </span>
        );
      },
    },
    {
      key: "medio",
      header: "Medio",
      hideBelow: "sm",
      render: (f) => <span className="text-muted">{datosFila(f).medio || "—"}</span>,
    },
    {
      key: "monto",
      header: "Monto",
      align: "right",
      render: (f) => <span className="font-medium tabular-nums text-text">{fmtPrecio(datosFila(f).monto)}</span>,
    },
    {
      key: "estado",
      header: "Estado",
      render: (f) =>
        f.tipo === "recibo" ? <Badge tone="success">Registrado</Badge> : <Badge tone="warning">En revisión</Badge>,
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      render: (f) => (f.tipo === "recibo" ? accionesRecibo(f.pago) : null),
    },
  ];

  function accionesRecibo(p: Pago) {
    return (
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
    );
  }

  if (primeraPagina.total === 0 && filas.length === 0) {
    return <EmptyState title="Todavía no tiene pagos registrados." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {whatsapp && (
        <WhatsAppPagos contacto={whatsapp} seleccionados={seleccionados} onLimpiar={() => setSeleccion([])} />
      )}

      <Table<FilaPago>
        columns={columnas}
        rows={filas}
        rowKey={(f) => f.clave}
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
