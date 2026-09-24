"use client";

import { useState } from "react";
import { Badge, Button, EmptyState, Table, type TableColumn } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import { PRESUPUESTOS_CAIDOS } from "@/lib/cuenta-corriente/mensajes";
import type { Presupuesto } from "@/lib/cuenta-corriente/tipos";
import { urlDocumento, type DocumentoAbierto, type RangoEmision } from "@/lib/cuenta-corriente/vista-facturas";
import {
  LABEL_ESTADO_PRESUPUESTO,
  TONO_ESTADO_PRESUPUESTO,
  queryPresupuestos,
  type FiltroPresupuestos,
} from "@/lib/cuenta-corriente/vista-presupuestos";
import type { ContactoWhatsApp } from "@/lib/cuenta-corriente/whatsapp";
import { IconoDescarga, IconoOjo } from "../iconos";
import { CargarMas } from "./CargarMas";
import { FiltrosPresupuestos } from "./FiltrosPresupuestos";
import { usePaginaApi } from "./usePaginaApi";
import { VisorDocumento } from "./VisorDocumento";
import { WhatsAppPresupuestos } from "./WhatsAppPresupuestos";

/**
 * Presupuestos (PRE-1): primera página del servidor; "Cargar más" y los
 * filtros (estado y fecha de emisión) contra `GET /api/mi-cuenta/presupuestos`,
 * que los resuelve en Alegra. Selección para WhatsApp (PRE-2) y PDF en el visor
 * de la página.
 */
export function PresupuestosSeccion({
  primeraPagina,
  whatsapp,
}: {
  primeraPagina: { presupuestos: Presupuesto[]; total: number };
  whatsapp: ContactoWhatsApp | null;
}) {
  const pagina = usePaginaApi<Presupuesto>({
    ruta: "/api/mi-cuenta/presupuestos",
    campo: "presupuestos",
    inicial: { items: primeraPagina.presupuestos, total: primeraPagina.total },
    errorCarga: PRESUPUESTOS_CAIDOS,
  });
  const [filtro, setFiltro] = useState<FiltroPresupuestos>("todos");
  const [rango, setRango] = useState<RangoEmision>({});
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [visor, setVisor] = useState<DocumentoAbierto | null>(null);

  function aplicar(f: FiltroPresupuestos, r: RangoEmision) {
    setSeleccion([]);
    pagina.filtrar(queryPresupuestos(f, r));
  }

  const seleccionados = pagina.items.filter((p) => seleccion.includes(p.alegraId));

  const columnas: TableColumn<Presupuesto>[] = [
    {
      key: "id",
      header: "Presupuesto",
      render: (p) => <span className="font-medium text-text">{p.id}</span>,
    },
    { key: "fecha", header: "Emisión", hideBelow: "sm", render: (p) => <span className="text-muted">{p.fecha}</span> },
    {
      key: "validoHasta",
      header: "Válido hasta",
      hideBelow: "md",
      render: (p) => <span className="text-muted">{p.validoHasta || "—"}</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      render: (p) => <span className="font-medium tabular-nums text-text">{fmtPrecio(p.total)}</span>,
    },
    {
      key: "estado",
      header: "Estado",
      render: (p) => <Badge tone={TONO_ESTADO_PRESUPUESTO[p.estado]}>{LABEL_ESTADO_PRESUPUESTO[p.estado]}</Badge>,
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      render: (p) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Ver presupuesto ${p.id}`}
            onClick={() => setVisor({ kind: "presupuesto", alegraId: p.alegraId, titulo: `Presupuesto ${p.id}` })}
          >
            <IconoOjo />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Descargar presupuesto ${p.id}`}
            href={urlDocumento("presupuesto", p.alegraId, true)}
          >
            <IconoDescarga />
          </Button>
        </div>
      ),
    },
  ];

  // Sin ningún presupuesto (la primera página es sin filtros): no se ofrecen filtros sobre nada.
  if (primeraPagina.total === 0) {
    return <EmptyState title="Todavía no tiene presupuestos." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <FiltrosPresupuestos
        filtro={filtro}
        rango={rango}
        onFiltro={(f) => {
          setFiltro(f);
          aplicar(f, rango);
        }}
        onRango={(r) => {
          setRango(r);
          aplicar(filtro, r);
        }}
      />

      {whatsapp && (
        <WhatsAppPresupuestos
          contacto={whatsapp}
          seleccionados={seleccionados}
          onLimpiar={() => setSeleccion([])}
        />
      )}

      <Table<Presupuesto>
        columns={columnas}
        rows={pagina.items}
        rowKey={(p) => p.alegraId}
        selectable={!!whatsapp}
        selectedKeys={seleccion}
        onSelectionChange={setSeleccion}
        empty="No hay presupuestos para este filtro."
      />

      <CargarMas
        cantidad={pagina.items.length}
        total={pagina.total}
        cargando={pagina.cargando}
        error={pagina.error}
        onCargarMas={pagina.cargarMas}
      />

      <VisorDocumento doc={visor} onClose={() => setVisor(null)} />
    </div>
  );
}
