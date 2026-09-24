"use client";

import { useMemo, useRef, useState } from "react";
import { Badge, Button, EmptyState, Progress, Table, type TableColumn } from "@myd-org/ui";
import { fmtPrecio } from "@/lib/format";
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
import { WhatsAppFacturas, type ContactoWhatsApp } from "./WhatsAppFacturas";

const ERROR_CARGA = "No pudimos obtener sus facturas. Inténtelo de nuevo en unos minutos.";

/** Clave de una consulta a la API: si no cambió, lo cargado sirve. */
const claveConsulta = (estado: FiltroEstado, rango: RangoEmision) => queryFacturas(estado, rango);

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
  const [items, setItems] = useState<Factura[]>(primeraPagina.facturas);
  const [total, setTotal] = useState(primeraPagina.total);
  const [cargada, setCargada] = useState(claveConsulta("todas", {}));
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  // Sólo la última consulta pinta: un filtro rápido no puede quedar tapado por una respuesta vieja.
  const ultima = useRef(0);

  const modoAbiertas = esFiltroDeAbiertas(estado) && abiertas !== null;
  const filas = useMemo(
    () => (modoAbiertas && esFiltroDeAbiertas(estado) && abiertas ? filtrarAbiertas(abiertas, estado, rango) : items),
    [modoAbiertas, estado, abiertas, rango, items],
  );

  async function pedir(est: FiltroEstado, r: RangoEmision, start: number) {
    const id = ++ultima.current;
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/mi-cuenta/facturas${queryFacturas(est, r, start)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { facturas?: Factura[]; total?: number; error?: string } | null;
      if (id !== ultima.current) return;
      if (!res.ok || !body?.facturas) {
        setError(body?.error ?? ERROR_CARGA);
        return;
      }
      const nuevas = body.facturas;
      setItems((prev) => (start === 0 ? nuevas : [...prev, ...nuevas]));
      setTotal(body.total ?? 0);
      setCargada(claveConsulta(est, r));
    } catch {
      if (id === ultima.current) setError(ERROR_CARGA);
    } finally {
      if (id === ultima.current) setCargando(false);
    }
  }

  function aplicar(est: FiltroEstado, r: RangoEmision) {
    setSeleccion([]);
    setError(null);
    // Pendientes/Vencidas no consultan: se recalculan sobre las abiertas.
    if (esFiltroDeAbiertas(est) && abiertas !== null) return;
    if (claveConsulta(est, r) === cargada) return;
    void pedir(est, r, 0);
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
          cargando={cargando}
          error={error}
          onCargarMas={() => void pedir(estado, rango, items.length)}
        />
      )}
    </div>
  );
}
