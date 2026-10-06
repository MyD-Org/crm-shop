"use client"

import { useCallback, useEffect, useState } from "react"
import { Alert, Button, Dialog, Field, Input, Spinner, Table, type TableColumn } from "@myd-org/ui"
import type { CambioPrecios } from "@/lib/precios-online-cambios"
import type { FilaMuestra, ResultadoPrevia } from "@/lib/precios-online-repo"
import { TEXTOS, fmtPct, fmtPrecio } from "./precios-online-textos"
import { api, ErrorApi } from "./tipos"

interface Props {
  open: boolean
  onClose: () => void
  /** Los cambios a previsualizar y aplicar. Con `revertirId` los arma el servidor. */
  cambios: CambioPrecios[] | null
  /** Revertir esta entrada del historial (en lugar de `cambios`). */
  revertirId?: string
  titulo: string
  /** Si hay variación alta, se pide escribir este nombre (el de la lista afectada). */
  nombreParaConfirmar: string
  onAplicado: () => void
}

type Fase =
  | { tipo: "generando" }
  | { tipo: "lista"; previa: ResultadoPrevia }
  | { tipo: "error"; mensaje: string }
  | { tipo: "aplicando"; previa: ResultadoPrevia }

/**
 * Vista previa obligatoria de todo cambio de precios: nada se aplica sin verla. Pide la previa al
 * abrirse (el servidor la calcula y la deshace), muestra el resumen y, si alguna variación SUPERA
 * el umbral de confirmación, exige escribir el nombre de la lista antes de habilitar "Aplicar".
 */
export function VistaPreviaDialog({ open, onClose, cambios, revertirId, titulo, nombreParaConfirmar, onAplicado }: Props) {
  const [fase, setFase] = useState<Fase>({ tipo: "generando" })
  const [cambiosEfectivos, setCambiosEfectivos] = useState<CambioPrecios[] | null>(cambios)
  const [nombre, setNombre] = useState("")
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelado = false
    void (async () => {
      setFase({ tipo: "generando" })
      setNombre("")
      try {
        if (revertirId) {
          const r = await api<{ previa: ResultadoPrevia; cambios: CambioPrecios[] }>(
            `/api/admin/precios-online/historial/${revertirId}/revertir`,
            { method: "POST", body: JSON.stringify({ previa: true }) },
          )
          if (cancelado) return
          setCambiosEfectivos(r.cambios)
          setFase({ tipo: "lista", previa: r.previa })
        } else {
          const r = await api<{ previa: ResultadoPrevia }>("/api/admin/precios-online/previsualizar", {
            method: "POST",
            body: JSON.stringify({ cambios }),
          })
          if (cancelado) return
          setCambiosEfectivos(cambios)
          setFase({ tipo: "lista", previa: r.previa })
        }
      } catch (err) {
        if (!cancelado) setFase({ tipo: "error", mensaje: err instanceof ErrorApi ? err.message : TEXTOS.previa.errorGenerico })
      }
    })()
    return () => {
      cancelado = true
    }
  }, [open, cambios, revertirId, intento])

  const aplicar = useCallback(
    async (previa: ResultadoPrevia) => {
      setFase({ tipo: "aplicando", previa })
      const claves = { baseVersion: previa.baseVersion, huella: previa.huella, confirmaExtra: previa.requiereConfirmacionExtra }
      try {
        await api(
          revertirId ? `/api/admin/precios-online/historial/${revertirId}/revertir` : "/api/admin/precios-online/aplicar",
          { method: "POST", body: JSON.stringify(revertirId ? claves : { cambios: cambiosEfectivos, ...claves }) },
        )
        onAplicado()
      } catch (err) {
        setFase({ tipo: "error", mensaje: err instanceof ErrorApi ? err.message : TEXTOS.previa.errorGenerico })
      }
    },
    [cambiosEfectivos, onAplicado, revertirId],
  )

  const previa = fase.tipo === "lista" || fase.tipo === "aplicando" ? fase.previa : null
  const confirmado =
    !previa?.requiereConfirmacionExtra || nombre.trim().toLowerCase() === nombreParaConfirmar.trim().toLowerCase()

  const columnas: TableColumn<FilaMuestra>[] = [
    {
      key: "producto",
      header: TEXTOS.previa.columnaProducto,
      render: (f) => (
        <span>
          {f.nombre}
          {f.code ? <span style={{ color: "var(--ink-faint)" }}> · {f.code}</span> : null}
        </span>
      ),
    },
    { key: "lista", header: TEXTOS.previa.columnaLista, render: (f) => f.listaNombre ?? "—" },
    { key: "antes", header: TEXTOS.previa.columnaAntes, align: "right", render: (f) => fmtPrecio(f.antes) },
    { key: "despues", header: TEXTOS.previa.columnaDespues, align: "right", render: (f) => fmtPrecio(f.despues) },
    { key: "variacion", header: TEXTOS.previa.columnaVariacion, align: "right", render: (f) => fmtPct(f.variacionPct) },
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && fase.tipo !== "aplicando" && onClose()}
      title={titulo}
      size="lg"
      dismissible={false}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={fase.tipo === "aplicando"}>
            {TEXTOS.previa.cancelar}
          </Button>
          {fase.tipo === "error" ? (
            <Button onClick={() => setIntento((n) => n + 1)}>{TEXTOS.previa.generarOtra}</Button>
          ) : (
            <Button
              onClick={() => previa && void aplicar(previa)}
              disabled={!previa || !confirmado || fase.tipo === "aplicando"}
              loading={fase.tipo === "aplicando"}
            >
              {fase.tipo === "aplicando" ? TEXTOS.previa.aplicando : TEXTOS.previa.aplicar}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {fase.tipo === "generando" && (
          <p className="flex items-center gap-2 text-sm" style={{ color: "var(--ink-soft)" }}>
            <Spinner /> {TEXTOS.previa.generando}
          </p>
        )}
        {fase.tipo === "error" && <Alert tone="danger">{fase.mensaje}</Alert>}
        {previa && (
          <>
            {previa.productosAfectados === 0 && <Alert tone="neutral">{TEXTOS.previa.sinCambios}</Alert>}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Dato etiqueta={TEXTOS.previa.afectados} valor={String(previa.productosAfectados)} />
              <Dato etiqueta={TEXTOS.previa.suben} valor={String(previa.suben)} />
              <Dato etiqueta={TEXTOS.previa.bajan} valor={String(previa.bajan)} />
              <Dato etiqueta={TEXTOS.previa.nuevos} valor={String(previa.nuevos)} />
              <Dato etiqueta={TEXTOS.previa.quitan} valor={String(previa.quitan)} />
              <Dato etiqueta={TEXTOS.previa.sinCosto} valor={String(previa.sinPrecio)} />
              <Dato
                etiqueta={TEXTOS.previa.mayorSuba}
                valor={previa.mayorSubaPct === null ? "—" : `${fmtPct(previa.mayorSubaPct)} (${fmtPrecio(previa.mayorSubaMonto)})`}
              />
              <Dato
                etiqueta={TEXTOS.previa.mayorBaja}
                valor={previa.mayorBajaPct === null ? "—" : `${fmtPct(previa.mayorBajaPct)} (${fmtPrecio(previa.mayorBajaMonto)})`}
              />
            </dl>
            {previa.advertencias.listaSuperaReferencia > 0 && (
              <Alert tone="warning">{TEXTOS.previa.avisoSuperaReferencia(previa.advertencias.listaSuperaReferencia)}</Alert>
            )}
            {previa.requiereConfirmacionExtra && (
              <div className="flex flex-col gap-2">
                <Alert tone="warning">{TEXTOS.previa.confirmacionExtra(previa.umbralPct)}</Alert>
                <Field label={TEXTOS.previa.escribirNombre} hint={nombreParaConfirmar}>
                  <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" />
                </Field>
              </div>
            )}
            {previa.muestra.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{TEXTOS.previa.muestra}</h3>
                <Table columns={columnas} rows={previa.muestra} rowKey={(f) => `${f.alegraId}|${f.listaId}`} />
              </section>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt style={{ color: "var(--ink-soft)" }}>{etiqueta}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  )
}
