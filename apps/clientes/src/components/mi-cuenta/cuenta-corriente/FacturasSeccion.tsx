"use client";

import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Progress, Table, type TableColumn } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
import { FACTURAS_CAIDAS } from "@/lib/cuenta-corriente/mensajes";
import type { Factura } from "@/lib/cuenta-corriente/tipos";
import {
  LABEL_ESTADO,
  TONO_ESTADO,
  esFiltroDeAbiertas,
  esPagoParcial,
  filtrarAbiertas,
  queryFacturas,
  saldoDe,
  urlDocumento,
  type FiltroEstado,
  type RangoEmision,
} from "@/lib/cuenta-corriente/vista-facturas";
import { IconoDescarga, IconoOjo } from "../iconos";
import { CargarMas } from "./CargarMas";
import { FiltrosFacturas } from "./FiltrosFacturas";
import { usePaginaApi } from "./usePaginaApi";
import { WhatsAppFacturas, type ContactoWhatsApp } from "./WhatsAppFacturas";

/**
 * Lista de facturas: primera página del servidor, "Cargar más" y filtros contra
 * `GET /api/mi-cuenta/facturas` (los resuelve Alegra, no el navegador).
 * Pendientes y Vencidas salen de las abiertas completas, sin pedir nada, como
 * en el portal del CRM.
 *
 * El estado lo controla el padre: las tarjetas de saldo lo cambian con "Ver
 * todas".
 */
export function FacturasSeccion({
  primeraPagina,
  abiertas,
  estado,
  onEstado,
  whatsapp,
  onVer,
}: {
  primeraPagina: { facturas: Factura[]; total: number };
  /** `null` = no se pudieron traer (saldo caído). */
  abiertas: Factura[] | null;
  estado: FiltroEstado;
  onEstado: (estado: FiltroEstado) => void;
  whatsapp: ContactoWhatsApp | null;
  onVer: (f: Factura) => void;
}) {
  const [rango, setRango] = useState<RangoEmision>({});
  const [seleccion, setSeleccion] = useState<string[]>([]);
  // Mismo hook que Pagos y Presupuestos: "Cargar más" pide la página siguiente
  // del filtro CARGADO y sólo la última consulta pinta, incluso si se vuelve al
  // filtro ya cargado con otra consulta en vuelo.
  const pagina = usePaginaApi<Factura>({
    ruta: "/api/mi-cuenta/facturas",
    campo: "facturas",
    inicial: { items: primeraPagina.facturas, total: primeraPagina.total },
    errorCarga: FACTURAS_CAIDAS,
  });
  const { items, total } = pagina;

  const modoAbiertas = esFiltroDeAbiertas(estado) && abiertas !== null;
  const filas = useMemo(
    () => (modoAbiertas && esFiltroDeAbiertas(estado) && abiertas ? filtrarAbiertas(abiertas, estado, rango) : items),
    [modoAbiertas, estado, abiertas, rango, items],
  );

  function aplicar(est: FiltroEstado, r: RangoEmision) {
    setSeleccion([]);
    // Pendientes/Vencidas no consultan: se recalculan sobre las abiertas.
    if (esFiltroDeAbiertas(est) && abiertas !== null) return;
    pagina.filtrar(queryFacturas(est, r));
  }

  const seleccionadas = filas.filter((f) => seleccion.includes(f.alegraId));

  const columnas: TableColumn<Factura>[] = [
    {
      key: "id",
      header: "Comprobante",
      render: (f) => (
        <div className="flex flex-col">
          <span className="font-medium text-text">{f.id}</span>
          <span className="text-xs text-muted">{f.tipo}</span>
        </div>
      ),
    },
    { key: "emision", header: "Emisión", hideBelow: "sm", render: (f) => <span className="text-muted">{f.emision}</span> },
    {
      key: "vencimiento",
      header: "Vencimiento",
      render: (f) => <span className="text-muted">{f.vencimiento || "—"}</span>,
    },
    {
      key: "importe",
      header: "Importe",
      align: "right",
      render: (f) =>
        esPagoParcial(f) ? (
          <div className="inline-flex flex-col items-end gap-1 tabular-nums">
            <span className="text-xs text-muted">{fmtPrecio(f.importe)}</span>
            <div className="w-24">
              <Progress value={f.pagado ?? 0} max={f.importe} size="sm" aria-label="Pagado de la factura" />
            </div>
            <span className="font-medium text-text">Saldo {fmtPrecio(saldoDe(f))}</span>
          </div>
        ) : (
          <span className="font-medium tabular-nums text-text">{fmtPrecio(f.importe)}</span>
        ),
    },
    {
      key: "estado",
      header: "Estado",
      hideBelow: "md",
      render: (f) => (
        <div className="inline-flex flex-col items-start gap-1">
          <Badge tone={TONO_ESTADO[f.estado]}>{LABEL_ESTADO[f.estado]}</Badge>
          {esPagoParcial(f) && <span className="text-xs text-muted">Pago parcial</span>}
        </div>
      ),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      render: (f) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" aria-label={`Ver factura ${f.id}`} onClick={() => onVer(f)}>
            <IconoOjo />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Descargar factura ${f.id}`}
            href={urlDocumento("factura", f.alegraId, true)}
          >
            <IconoDescarga />
          </Button>
        </div>
      ),
    },
  ];

  const sinFiltros = estado === "todas" && !rango.start && !rango.end;
  const vacio =
    sinFiltros && primeraPagina.total === 0 && total === 0 ? (
      <EmptyState title="Todavía no tiene facturas emitidas." />
    ) : (
      "No hay facturas para este filtro."
    );

  return (
    <div className="flex flex-col gap-4">
      <FiltrosFacturas
        estado={estado}
        rango={rango}
        sinAbiertas={abiertas === null}
        onEstado={(e) => {
          onEstado(e);
          aplicar(e, rango);
        }}
        onRango={(r) => {
          setRango(r);
          aplicar(estado, r);
        }}
      />

      {whatsapp && (
        <WhatsAppFacturas contacto={whatsapp} seleccionadas={seleccionadas} onLimpiar={() => setSeleccion([])} />
      )}

      <Table<Factura>
        columns={columnas}
        rows={filas}
        rowKey={(f) => f.alegraId}
        selectable={!!whatsapp}
        selectedKeys={seleccion}
        onSelectionChange={setSeleccion}
        empty={vacio}
      />

      {modoAbiertas ? (
        <CargarMas cantidad={filas.length} total={filas.length} cargando={false} error={null} />
      ) : (
        <CargarMas
          cantidad={items.length}
          total={total}
          cargando={pagina.cargando}
          error={pagina.error}
          onCargarMas={pagina.cargarMas}
        />
      )}
    </div>
  );
}
