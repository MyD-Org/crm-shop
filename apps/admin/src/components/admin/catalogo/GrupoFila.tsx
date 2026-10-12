"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Badge, Button, Dialog, Tooltip } from "@myd-org/ui"
import { api, ErrorApi, precioDeLista, stockDe, type ProductoDto, type VarianteDto } from "./tipos"
import {
  AYUDA_NO_SE_VENDE,
  TEXTO_NO_SE_VENDE,
  cantidadInactivas,
  estaActiva,
  nombreDeVariante,
  textoCantidadVariantes,
  textoQuitar,
} from "./variantes-ui"

/**
 * Un modelo en el listado del panel: el producto con sus variantes anidadas. El «ancla» (padre de
 * Alegra o base de un grupo armado a mano) es la fila; al expandirla se ven las opciones con su
 * stock, precio y estado. El padre se marca «No se vende» y no tiene stock ni precio propios.
 */

interface CeldaProps {
  producto: ProductoDto
  /** El nombre, el SKU y los badges de siempre: el panel los arma y acá se les suma lo del modelo. */
  cabecera: ReactNode
  /** Cuando se quita un producto del grupo: el panel recarga el listado. */
  onCambio: () => void
  /** Error para mostrar en el panel (no se pierde si el diálogo se cierra). */
  onError: (mensaje: string) => void
}

export function GrupoCelda({ producto, cabecera, onCambio, onError }: CeldaProps) {
  const [abierto, setAbierto] = useState(false)
  const [quitando, setQuitando] = useState<VarianteDto | null>(null)
  const [enCurso, setEnCurso] = useState(false)
  const inactivas = cantidadInactivas(producto.variantes)

  async function quitar() {
    if (!quitando) return
    setEnCurso(true)
    try {
      await api("/api/admin/catalogo/variantes", { method: "DELETE", body: JSON.stringify({ alegraId: quitando.alegraId }) })
      setQuitando(null)
      onCambio()
    } catch (err) {
      setQuitando(null)
      onError(err instanceof ErrorApi ? err.message : "No pudimos quitar el producto del modelo. Inténtelo nuevamente.")
    } finally {
      setEnCurso(false)
    }
  }

  return (
    <>
      {cabecera}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Button
          variant="ghost"
          size="inline"
          aria-expanded={abierto}
          aria-label={`${abierto ? "Ocultar" : "Mostrar"} las variantes de ${producto.nombreEfectivo}`}
          onClick={(e) => {
            e.stopPropagation()
            setAbierto((v) => !v)
          }}
        >
          {abierto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {textoCantidadVariantes(producto.variantes.length)}
        </Button>
        {producto.tipo === "padre" && (
          <Tooltip content={AYUDA_NO_SE_VENDE}>
            <span>
              <Badge tone="neutral">{TEXTO_NO_SE_VENDE}</Badge>
            </span>
          </Tooltip>
        )}
        {producto.tipo !== "padre" && <Badge tone="info">Grupo armado a mano</Badge>}
        {inactivas > 0 && <Badge tone="warning">{inactivas === 1 ? "1 de baja en Alegra" : `${inactivas} de baja en Alegra`}</Badge>}
      </div>
      {abierto && (
        <div onClick={(e) => e.stopPropagation()} className="mt-2">
          <ListaVariantes variantes={producto.variantes} onQuitar={(v) => setQuitando(v)} />
        </div>
      )}

      {quitando && (
        <Dialog
          open
          size="sm"
          onOpenChange={(o) => {
            if (!o) setQuitando(null)
          }}
          title="Confirme la acción"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setQuitando(null)} disabled={enCurso}>
                Cancelar
              </Button>
              <Button onClick={() => void quitar()} disabled={enCurso}>
                {enCurso ? "Quitando…" : "Quitar del modelo"}
              </Button>
            </div>
          }
        >
          <p className="text-sm" style={{ color: "var(--ink)" }}>
            {textoQuitar(nombreDeVariante(quitando))}
          </p>
        </Dialog>
      )}
    </>
  )
}

interface ListaProps {
  variantes: VarianteDto[]
  /** Si se pasa, los productos sumados a mano (menos la base) muestran «Quitar del modelo». */
  onQuitar?: (variante: VarianteDto) => void
  /** Algo más por variante (en el diálogo: el editor de la foto propia). */
  extra?: (variante: VarianteDto) => ReactNode
}

/** La lista de opciones de un modelo. Sólo lectura: lo de Alegra no se edita desde acá. */
export function ListaVariantes({ variantes, onQuitar, extra }: ListaProps) {
  if (variantes.length === 0) return null
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Variantes del modelo">
      {variantes.map((v) => {
        const precio = precioDeLista(v.prices)
        const stock = stockDe(v.stock)
        const activa = estaActiva(v)
        return (
          <li
            key={v.alegraId}
            className="rounded-[var(--radius)] p-2"
            style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                {nombreDeVariante(v)}
              </span>
              <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
                {v.code ? `SKU ${v.code}` : `ID ${v.alegraId}`}
              </span>
              <span className="text-xs tabular-nums" style={{ color: "var(--ink-soft)" }}>
                {precio ?? "Sin precio"}
              </span>
              <span className="text-xs tabular-nums" style={{ color: stock?.hay ? "var(--ink-soft)" : "var(--ink-faint)" }}>
                Stock: {stock ? stock.texto : "sin dato"}
              </span>
              {!activa && <Badge tone="warning">De baja en Alegra</Badge>}
              {v.manual && !v.esAncla && <Badge tone="info">Sumado a mano</Badge>}
              {v.esAncla && <Badge tone="info">Base del grupo</Badge>}
              {v.fotos.length > 0 && <Badge tone="neutral">Foto propia</Badge>}
              {onQuitar && v.manual && !v.esAncla && (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onQuitar(v)}>
                  Quitar del modelo
                </Button>
              )}
            </div>
            {extra?.(v)}
          </li>
        )
      })}
    </ul>
  )
}
