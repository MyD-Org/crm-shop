"use client"

import { Badge, Button, Input, Table, type TableColumn } from "@myd-org/ui"
import { MENSAJE_SIN_REFERENCIA, type FilaLista } from "@/lib/etiquetas/lista"
import { codigoDeBarras } from "@/lib/etiquetas/trabajos"
import { MENSAJE_CANTIDAD, validarCantidad } from "@/lib/etiquetas/texto"

interface Props {
  lista: FilaLista[]
  onCambiar: (lista: FilaLista[]) => void
  /** Slug de la sucursal cuyo stock se muestra (null = carga manual). */
  sucursal: string | null
  /** El tipo elegido imprime código de barras: las filas sin referencia se omiten. */
  usaReferencia: boolean
  /** Filas a marcar con error de cantidad (se marcan al perder el foco o al imprimir). */
  invalidas: Set<string>
  onTocar: (alegraId: string, valida: boolean) => void
}

export function ListaImpresion({ lista, onCambiar, sucursal, usaReferencia, invalidas, onTocar }: Props) {
  const cambiar = (alegraId: string, cambios: Partial<FilaLista>) =>
    onCambiar(lista.map((f) => (f.alegraId === alegraId ? { ...f, ...cambios } : f)))

  const columnas: TableColumn<FilaLista>[] = [
    {
      key: "producto",
      header: "Producto",
      render: (f) => (
        <div className="min-w-0">
          <div className="truncate">{f.nombre}</div>
          <div className="text-xs" style={{ color: "var(--ink-faint)" }}>{f.referencia ?? "Sin referencia"}</div>
          {usaReferencia && !f.referencia && (
            <div className="text-xs" style={{ color: "var(--amber)" }}>{MENSAJE_SIN_REFERENCIA}</div>
          )}
          {usaReferencia && f.referencia && <AvisoCodigo referencia={f.referencia} />}
        </div>
      ),
    },
    ...(sucursal
      ? [
          {
            key: "stock",
            header: "Stock",
            align: "right" as const,
            hideBelow: "sm" as const,
            render: (f: FilaLista) =>
              f.sinStock ? <Badge tone="warning">Sin stock</Badge> : <span>{f.stock[sucursal] ?? "—"}</span>,
          },
        ]
      : []),
    {
      key: "cantidad",
      header: "Cantidad",
      align: "right",
      render: (f) => (
        <div style={{ width: 88, marginLeft: "auto" }}>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={999}
            step={1}
            value={f.cantidad}
            aria-label={`Cantidad de etiquetas de ${f.nombre}`}
            aria-invalid={invalidas.has(f.alegraId) || undefined}
            onChange={(e) => cambiar(f.alegraId, { cantidad: e.target.value, sinStock: undefined })}
            onBlur={() => onTocar(f.alegraId, validarCantidad(f.cantidad).ok)}
          />
        </div>
      ),
    },
    {
      key: "quitar",
      header: <span className="sr-only">Quitar</span>,
      align: "right",
      render: (f) => (
        <Button size="sm" variant="ghost" onClick={() => onCambiar(lista.filter((x) => x.alegraId !== f.alegraId))}>
          Quitar
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-2">
      <Table
        columns={columnas}
        rows={lista}
        rowKey={(f) => f.alegraId}
        empty={<span>Agregue productos desde la búsqueda o por marca.</span>}
      />
      {invalidas.size > 0 && (
        <p className="text-sm text-danger" role="alert">{MENSAJE_CANTIDAD}</p>
      )}
    </div>
  )
}

/** Avisa antes de imprimir si el código va sin el sufijo o si el producto se va a omitir. */
function AvisoCodigo({ referencia }: { referencia: string }) {
  const cod = codigoDeBarras(referencia)
  if (cod.ok && !cod.sinSufijo) return null
  return (
    <div className="text-xs" style={{ color: "var(--amber)" }}>
      {cod.ok ? `Se imprime sin el sufijo: ${cod.codigo}` : `No se imprimirá. ${cod.mensaje}`}
    </div>
  )
}
