"use client"

import { useState } from "react"
import { Alert, Button, Checkbox, Dialog, Input } from "@myd-org/ui"
import { decimalCanonico, esCoefValido, MAX_AJUSTES_LOTE, type CambioPrecios } from "@/lib/precios-online-cambios"
import type { ListaDto } from "@/lib/precios-online-repo"
import { VistaPreviaDialog } from "./VistaPreviaDialog"
import { TEXTOS, fmtCoef } from "./precios-online-textos"

interface Props {
  open: boolean
  onClose: () => void
  /** Productos seleccionados en la grilla (ids de Alegra). */
  alegraIds: string[]
  listas: ListaDto[]
  onAplicado: () => void
}

interface FilaForm {
  coef: string
  quitar: boolean
}

const aPunto = (v: string) => v.trim().replace(",", ".")
const T = TEXTOS.ajusteLote

/**
 * Asignación masiva de porcentajes: una fila por lista activa con el coeficiente nuevo (vacío = sin
 * cambio) o la opción de quitar el ajuste por producto. Al confirmar abre la vista previa de siempre
 * (VistaPreviaDialog); nada se guarda sin verla.
 */
export function AjusteProductosDialog({ open, onClose, alegraIds, listas, onAplicado }: Props) {
  const activas = listas.filter((l) => l.activa).slice(0, MAX_AJUSTES_LOTE)
  const [filas, setFilas] = useState<Record<string, FilaForm>>({})
  const [error, setError] = useState("")
  const [previa, setPrevia] = useState<{ cambios: CambioPrecios[]; nombre: string } | null>(null)

  const fila = (id: string): FilaForm => filas[id] ?? { coef: "", quitar: false }
  const poner = (id: string, parcial: Partial<FilaForm>) => setFilas((f) => ({ ...f, [id]: { ...fila(id), ...parcial } }))

  const revisar = () => {
    const ajustes: { listaId: string; coeficiente: string | null }[] = []
    let primera: string | null = null
    for (const l of activas) {
      const f = fila(l.id)
      if (f.quitar) {
        ajustes.push({ listaId: l.id, coeficiente: null })
      } else if (f.coef.trim() !== "") {
        const c = decimalCanonico(aPunto(f.coef), 4)
        if (c === null || !esCoefValido(c)) {
          setError(T.coefInvalido(l.nombre))
          return
        }
        ajustes.push({ listaId: l.id, coeficiente: c })
      } else continue
      primera ??= l.nombre
    }
    if (ajustes.length === 0) {
      setError(T.sinNada)
      return
    }
    setError("")
    setPrevia({ cambios: [{ op: "ajusteProductos", alegraIds, ajustes }], nombre: primera ?? "" })
  }

  if (previa) {
    return (
      <VistaPreviaDialog
        open={open}
        onClose={() => {
          setPrevia(null)
          onClose()
        }}
        onVolver={() => setPrevia(null)}
        cambios={previa.cambios}
        titulo={T.titulo}
        nombreParaConfirmar={previa.nombre}
        onAplicado={() => {
          setPrevia(null)
          setFilas({})
          onAplicado()
        }}
      />
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={T.titulo}
      description={T.descripcion(alegraIds.length)}
      dismissible={false}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{T.cancelar}</Button>
          <Button onClick={revisar}>{T.continuar}</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left" style={{ color: "var(--ink-soft)" }}>
              <th className="py-1 pr-2 font-medium">{T.lista}</th>
              <th className="py-1 pr-2 font-medium">{T.coefGeneral}</th>
              <th className="py-1 pr-2 font-medium">{T.nuevoCoef}</th>
              <th className="py-1 font-medium">{T.quitar}</th>
            </tr>
          </thead>
          <tbody>
            {activas.map((l) => {
              const f = fila(l.id)
              return (
                <tr key={l.id}>
                  <td className="py-1 pr-2">{l.nombre}</td>
                  <td className="py-1 pr-2 tabular-nums">{fmtCoef(l.coeficiente)}</td>
                  <td className="py-1 pr-2">
                    <Input
                      inputMode="decimal"
                      value={f.coef}
                      disabled={f.quitar}
                      placeholder={T.sinCambio}
                      aria-label={`${T.nuevoCoef}: ${l.nombre}`}
                      onChange={(e) => poner(l.id, { coef: e.target.value })}
                    />
                  </td>
                  <td className="py-1">
                    <Checkbox
                      checked={f.quitar}
                      onCheckedChange={(v) => poner(l.id, { quitar: v === true, coef: v === true ? "" : f.coef })}
                      aria-label={`${T.quitar}: ${l.nombre}`}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="text-xs" style={{ color: "var(--ink-soft)" }}>{T.ayudaQuitar}</p>
      </div>
    </Dialog>
  )
}
