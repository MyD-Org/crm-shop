"use client"

import { useCallback, useEffect, useState } from "react"
import { Alert, Badge, Button, EmptyState, Table, type TableColumn } from "@myd-org/ui"
import type { HistorialDto } from "@/lib/precios-online-repo"
import { VistaPreviaDialog } from "./VistaPreviaDialog"
import { TEXTOS } from "./precios-online-textos"
import { api, ErrorApi, fmtFechaHora } from "./tipos"

const PAGINA = 25
/** Entradas que no se pueden revertir (el servidor también las rechaza). */
const IRREVERTIBLES = new Set(["revertir", "costo_aprobado", "costo_rechazado"])

interface Props {
  onCambio: () => void
}

function detalle(h: HistorialDto): string {
  const a = h.antes ?? {}
  const d = h.despues ?? {}
  const nombre = String((d.nombre as string | undefined) ?? (a.nombre as string | undefined) ?? "")
  switch (h.tipo) {
    case "lista_alta":
    case "lista_baja":
      return nombre
    case "lista_edicion":
      return `${nombre}: ${a.coeficiente ?? "—"} → ${d.coeficiente ?? "—"}`
    case "override_alta":
    case "override_edicion":
    case "override_baja": {
      const o = (h.despues ?? h.antes ?? {}) as Record<string, unknown>
      return `${o.tipo === "marca" ? `Marca ${o.marca}` : "Categoría"}: ${a.coeficiente ?? "—"} → ${d.coeficiente ?? "—"}`
    }
    case "umbral":
      return `Confirmación ${a.confirmacionPct ?? "—"} → ${d.confirmacionPct ?? "—"} %; retención ${a.retencionPct ?? "—"} → ${d.retencionPct ?? "—"} %`
    default:
      return ""
  }
}

/** Solapa "Historial": quién cambió qué y cuándo (inmutable) y revertir la última entrada de cada objeto. */
export function HistorialPanel({ onCambio }: Props) {
  const [data, setData] = useState<{ items: HistorialDto[]; total: number } | null>(null)
  const [start, setStart] = useState(0)
  const [error, setError] = useState("")
  const [revertir, setRevertir] = useState<HistorialDto | null>(null)

  const cargar = useCallback(async () => {
    try {
      setData(await api<{ items: HistorialDto[]; total: number }>(`/api/admin/precios-online/historial?start=${start}&limit=${PAGINA}`))
      setError("")
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : TEXTOS.historial.errorCarga)
    }
  }, [start])

  useEffect(() => {
    void (async () => {
      await cargar()
    })()
  }, [cargar])

  const columnas: TableColumn<HistorialDto>[] = [
    { key: "fecha", header: TEXTOS.historial.fecha, render: (h) => fmtFechaHora(h.creadoAt) },
    { key: "usuario", header: TEXTOS.historial.usuario, render: (h) => h.usuario },
    {
      key: "tipo",
      header: TEXTOS.historial.cambio,
      render: (h) => (
        <span>
          <span className="font-medium">{TEXTOS.tipoCambio[h.tipo] ?? h.tipo}</span>
          <span className="block text-xs" style={{ color: "var(--ink-soft)" }}>{detalle(h)}</span>
        </span>
      ),
    },
    {
      key: "afectados",
      header: TEXTOS.historial.afectados,
      align: "right",
      render: (h) => (typeof h.resumen?.productosAfectados === "number" ? String(h.resumen.productosAfectados) : "—"),
    },
    {
      key: "accion",
      header: "",
      align: "right",
      render: (h) =>
        h.revertido ? (
          <Badge tone="neutral">{TEXTOS.historial.revertido}</Badge>
        ) : IRREVERTIBLES.has(h.tipo) ? null : (
          <Button size="sm" variant="outline" onClick={() => setRevertir(h)}>
            {TEXTOS.historial.revertir}
          </Button>
        ),
    },
  ]

  const total = data?.total ?? 0
  return (
    <section className="flex flex-col gap-4" aria-label={TEXTOS.historial.titulo}>
      <h2 className="text-base font-medium">{TEXTOS.historial.titulo}</h2>
      {error && <Alert tone="danger">{error}</Alert>}
      {data && data.items.length === 0 ? (
        <EmptyState title={TEXTOS.historial.sinCambios} />
      ) : (
        <Table columns={columnas} rows={data?.items ?? []} rowKey={(h) => h.id} />
      )}
      {total > PAGINA && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span style={{ color: "var(--ink-soft)" }}>
            {start + 1}–{Math.min(start + PAGINA, total)} de {total}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" disabled={start === 0} onClick={() => setStart((s) => Math.max(0, s - PAGINA))}>
              {TEXTOS.grilla.anterior}
            </Button>
            <Button size="sm" variant="outline" disabled={start + PAGINA >= total} onClick={() => setStart((s) => s + PAGINA)}>
              {TEXTOS.grilla.siguiente}
            </Button>
          </span>
        </div>
      )}
      {revertir && (
        <VistaPreviaDialog
          open
          onClose={() => setRevertir(null)}
          cambios={null}
          revertirId={revertir.id}
          titulo={TEXTOS.historial.confirmarRevertir}
          nombreParaConfirmar={String((revertir.despues?.nombre as string | undefined) ?? (revertir.antes?.nombre as string | undefined) ?? "")}
          onAplicado={() => {
            setRevertir(null)
            void cargar()
            onCambio()
          }}
        />
      )}
    </section>
  )
}
