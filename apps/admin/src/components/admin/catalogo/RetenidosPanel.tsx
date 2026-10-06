"use client"

import { useCallback, useEffect, useState } from "react"
import { Alert, Button, Dialog, EmptyState, Table, type TableColumn } from "@myd-org/ui"
import type { RetenidoDto } from "@/lib/precios-online-costos"
import { TEXTOS, fmtPrecio } from "./precios-online-textos"
import { api, ErrorApi } from "./tipos"

interface Props {
  onCambio: () => void
}

type Accion = "aprobar" | "rechazar"

/**
 * Solapa "Retenidos": cambios de costo que informó Alegra y que superan el umbral de retención.
 * Mientras no se aprueban, el precio vigente no cambia. Aprobar o rechazar varios a la vez pide
 * confirmación (el servidor también la exige).
 */
export function RetenidosPanel({ onCambio }: Props) {
  const [items, setItems] = useState<RetenidoDto[] | null>(null)
  const [total, setTotal] = useState(0)
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [error, setError] = useState("")
  const [aviso, setAviso] = useState("")
  const [confirmar, setConfirmar] = useState<Accion | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const r = await api<{ items: RetenidoDto[]; total: number }>("/api/admin/precios-online/retenciones?limit=100")
      setItems(r.items)
      setTotal(r.total)
      setSeleccion([])
      setError("")
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : TEXTOS.retenidos.errorCarga)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await cargar()
    })()
  }, [cargar])

  const resolver = async (accion: Accion) => {
    setTrabajando(true)
    setConfirmar(null)
    try {
      const r = await api<{ resueltos: number; omitidos: string[] }>("/api/admin/precios-online/retenciones", {
        method: "POST",
        body: JSON.stringify({ accion, ids: seleccion, confirmar: true }),
      })
      setAviso(r.omitidos.length > 0 ? TEXTOS.retenidos.omitidos(r.omitidos.length) : TEXTOS.retenidos.resuelto)
      await cargar()
      onCambio()
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : TEXTOS.retenidos.errorCarga)
    } finally {
      setTrabajando(false)
    }
  }

  const accionar = (accion: Accion) => (seleccion.length > 1 ? setConfirmar(accion) : void resolver(accion))

  const columnas: TableColumn<RetenidoDto>[] = [
    {
      key: "producto",
      header: "Producto",
      render: (r) => (
        <span>
          <span className="font-medium">{r.nombre}</span>
          {r.code ? <span className="block text-xs" style={{ color: "var(--ink-faint)" }}>{r.code}</span> : null}
        </span>
      ),
    },
    { key: "vigente", header: TEXTOS.retenidos.costoVigente, align: "right", render: (r) => fmtPrecio(r.costoVigente) },
    {
      key: "propuesto",
      header: TEXTOS.retenidos.costoPropuesto,
      align: "right",
      render: (r) => (r.sinCosto ? TEXTOS.retenidos.sinCostoPropuesto : fmtPrecio(r.costoPropuesto)),
    },
    {
      key: "variacion",
      header: TEXTOS.retenidos.variacion,
      align: "right",
      render: (r) => (r.variacionPct === null ? "—" : `${Number(r.variacionPct).toLocaleString("es-AR")} %`),
    },
  ]

  return (
    <section className="flex flex-col gap-4" aria-label={TEXTOS.retenidos.titulo}>
      <div>
        <h2 className="text-base font-medium">{TEXTOS.retenidos.titulo}</h2>
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>{TEXTOS.retenidos.ayuda}</p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {aviso && <Alert tone="success">{aviso}</Alert>}
      {items && items.length === 0 ? (
        <EmptyState title={TEXTOS.retenidos.sinRetenidos} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm" style={{ color: "var(--ink-soft)" }}>
              {TEXTOS.retenidos.seleccion(seleccion.length)} · {total}
            </span>
            <span className="flex-1" />
            <Button size="sm" disabled={seleccion.length === 0 || trabajando} onClick={() => accionar("aprobar")}>
              {TEXTOS.retenidos.aprobar}
            </Button>
            <Button size="sm" variant="outline" disabled={seleccion.length === 0 || trabajando} onClick={() => accionar("rechazar")}>
              {TEXTOS.retenidos.rechazar}
            </Button>
          </div>
          <Table
            columns={columnas}
            rows={items ?? []}
            rowKey={(r) => r.id}
            selectable
            selectedKeys={seleccion}
            onSelectionChange={setSeleccion}
          />
        </>
      )}
      <Dialog
        open={confirmar !== null}
        onOpenChange={(v) => !v && setConfirmar(null)}
        title={confirmar === "aprobar" ? TEXTOS.retenidos.aprobar : TEXTOS.retenidos.rechazar}
        description={confirmar ? TEXTOS.retenidos.confirmarVarios(confirmar === "aprobar" ? "aprobar" : "rechazar", seleccion.length) : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmar(null)}>{TEXTOS.retenidos.cancelar}</Button>
            <Button onClick={() => confirmar && void resolver(confirmar)}>{TEXTOS.retenidos.confirmar}</Button>
          </div>
        }
      />
    </section>
  )
}
