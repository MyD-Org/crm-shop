"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { RefreshCw, ShoppingBag } from "lucide-react"
import { Badge, Button, EmptyState, Select, Table, type TableColumn } from "@myd-org/ui"
import type { PedidoListaDto } from "@/lib/pedidos-repo"
import { ESTADO_PEDIDO_LABEL } from "@/lib/pedidos-transiciones"
import {
  PAGO_REVISION_INFO,
  entregaLabel,
  fmtFechaPedido,
  fmtMoneda,
  pagoMetodoLabel,
  tonoEstado,
} from "./format"
import { FILTRO_TODOS, opcionesDeFiltro, queryDeLista, textoRango, type FiltroEstado } from "./logica"

interface ListaResponse {
  items: PedidoListaDto[]
  total: number
}

interface Props {
  /** Primera página sin filtro, cargada por el server component. */
  initialItems: PedidoListaDto[]
  initialTotal: number
  pageSize: number
}

const OPCIONES_FILTRO = opcionesDeFiltro()
const ERROR_CARGA = "No se pudieron cargar los pedidos. Inténtelo nuevamente."

export function PedidosShell({ initialItems, initialTotal, pageSize }: Props) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<FiltroEstado>(FILTRO_TODOS)
  const [items, setItems] = useState(initialItems)
  const [total, setTotal] = useState(initialTotal)
  const [start, setStart] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    // `no-store`: misma URL al volver a la lista; sin esto el navegador cachea el GET.
    const res = await fetch(`/api/admin/pedidos?${queryDeLista({ estado: filtro, start, limit: pageSize })}`, {
      cache: "no-store",
    }).catch(() => null)
    const data = res?.ok ? ((await res.json().catch(() => null)) as ListaResponse | null) : null
    if (data && Array.isArray(data.items)) {
      setItems(data.items)
      setTotal(data.total)
      setError("")
    } else {
      // Red caída o respuesta !ok: no se borra lo que ya está en pantalla, sólo se avisa.
      setError(ERROR_CARGA)
    }
    setCargando(false)
  }, [filtro, start, pageSize])

  // Carga al montar y al cambiar de filtro/página. Al montar también: `staleTimes.dynamic = 30`
  // hace que al volver del detalle la primera página server-rendered pueda tener hasta 30 s.
  // El IIFE es el patrón de ComprobantesShell (evita el falso positivo de set-state-in-effect).
  useEffect(() => {
    void (async () => {
      await load()
    })()
  }, [load])

  function cambiarFiltro(valor: string) {
    const next = OPCIONES_FILTRO.find((o) => o.value === valor)?.value as FiltroEstado | undefined
    if (!next || next === filtro) return
    setCargando(true)
    setFiltro(next)
    setStart(0)
  }

  function irAPagina(nuevoStart: number) {
    setCargando(true)
    setStart(nuevoStart)
  }

  const href = (p: PedidoListaDto) => `/admin/pedidos/${p.id}`

  const columns: TableColumn<PedidoListaDto>[] = [
    {
      key: "numero",
      header: "N.º",
      render: (p) => (
        <>
          {/* Link real además del click en la fila: la fila no es alcanzable con teclado. */}
          <Link
            href={href(p)}
            onClick={(e) => e.stopPropagation()}
            className="font-medium tabular-nums hover:underline"
            style={{ color: "var(--ink)" }}
          >
            {p.numero}
          </Link>
          <div className="text-xs" style={{ color: "var(--ink-faint)" }}>{fmtFechaPedido(p.creadoEn)}</div>
        </>
      ),
    },
    {
      key: "cliente",
      header: "Cliente",
      render: (p) => (
        <>
          <div className="font-medium" style={{ color: "var(--ink)" }}>{p.contactoNombre}</div>
          {p.clienteRazonSocial && (
            <div className="text-xs" style={{ color: "var(--ink-faint)" }}>{p.clienteRazonSocial}</div>
          )}
        </>
      ),
    },
    {
      key: "entrega",
      header: "Entrega",
      hideBelow: "md",
      className: "text-xs",
      render: (p) => <span style={{ color: "var(--ink-soft)" }}>{entregaLabel(p.entregaTipo)}</span>,
    },
    {
      key: "pago",
      header: "Pago",
      hideBelow: "lg",
      className: "text-xs",
      render: (p) => <span style={{ color: "var(--ink-soft)" }}>{pagoMetodoLabel(p.pagoMetodo)}</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      className: "font-medium tabular-nums",
      render: (p) => <span style={{ color: "var(--ink)" }}>{fmtMoneda(p.total)}</span>,
    },
    {
      key: "estado",
      header: "Estado",
      render: (p) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={tonoEstado(p.estado)}>{ESTADO_PEDIDO_LABEL[p.estado]}</Badge>
          {p.requiereRevision && (
            <span title="Los datos de facturación de este pedido requieren revisión.">
              <Badge tone="warning">Revisar</Badge>
            </span>
          )}
          {p.pagoRevision && (
            <span title={PAGO_REVISION_INFO[p.pagoRevision].detalle}>
              <Badge tone="danger">{PAGO_REVISION_INFO[p.pagoRevision].label}</Badge>
            </span>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select
          className="w-full sm:w-56"
          aria-label="Filtrar por estado"
          value={filtro}
          onValueChange={cambiarFiltro}
          options={OPCIONES_FILTRO}
        />
      </div>

      {/* `start === 0`: una página vacía más allá del final conserva el paginador para poder volver. */}
      {!items.length && !error && start === 0 ? (
        <EmptyState
          icon={<ShoppingBag size={28} strokeWidth={1.2} />}
          title={cargando ? "Cargando…" : "No hay pedidos para mostrar."}
        />
      ) : (
        <>
          <Table<PedidoListaDto>
            columns={columns}
            rows={items}
            rowKey={(p) => p.id}
            onRowClick={(p) => router.push(href(p))}
            empty="No hay pedidos para mostrar."
          />
          {error && (
            <div className="flex flex-col items-center gap-2 pt-2" role="alert">
              <p className="text-xs" style={{ color: "var(--red)" }}>{error}</p>
              <Button variant="ghost" size="sm" onClick={() => { setCargando(true); void load() }}>
                <RefreshCw size={13} /> Reintentar
              </Button>
            </div>
          )}
          {(total > 0 || start > 0) && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => irAPagina(Math.max(0, start - pageSize))}
                disabled={cargando || start === 0}
              >
                Anterior
              </Button>
              <p className="text-xs tabular-nums" style={{ color: "var(--ink-faint)" }} aria-live="polite">
                {cargando ? "Cargando…" : textoRango(start, items.length, total)}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => irAPagina(start + pageSize)}
                disabled={cargando || start + items.length >= total}
              >
                Siguiente
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
