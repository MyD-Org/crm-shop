"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { RefreshCw, ShoppingBag } from "lucide-react"
import {
  Badge,
  Button,
  EmptyState,
  SearchInput,
  SegmentedControl,
  Select,
  Table,
  type TableColumn,
} from "@myd-org/ui"
import type { Cola, ColasCounts, PedidoListaDto } from "@/lib/pedidos-repo"
import { ESTADO_PEDIDO_LABEL } from "@/lib/pedidos-transiciones"
import { PedidosTablero } from "./PedidosTablero"
import {
  PAGO_REVISION_INFO,
  entregaLabel,
  fmtFechaPedido,
  fmtMoneda,
  pagoMetodoLabel,
  tituloRevision,
  tonoEstado,
} from "./format"
import {
  COLAS_INFO,
  FILTRO_ENTREGA_TODOS,
  FILTRO_PAGO_TODOS,
  FILTRO_TODOS,
  ORDEN_COLAS,
  esSinFactura,
  opcionesDeFiltro,
  opcionesDeFiltroEntrega,
  opcionesDeFiltroPago,
  queryDeLista,
  textoRango,
  type FiltroEntrega,
  type FiltroEstado,
  type FiltroPago,
} from "./logica"

interface ListaResponse {
  items: PedidoListaDto[]
  total: number
  colas: ColasCounts
}

interface Props {
  /** Primera página sin filtro, cargada por el server component. */
  initialItems: PedidoListaDto[]
  initialTotal: number
  pageSize: number
}

type Vista = "lista" | "tablero"

const OPCIONES_FILTRO = opcionesDeFiltro()
const OPCIONES_ENTREGA = opcionesDeFiltroEntrega()
const OPCIONES_PAGO = opcionesDeFiltroPago()
const OPCIONES_VISTA = [
  { value: "lista", label: "Lista" },
  { value: "tablero", label: "Tablero" },
]
const ERROR_CARGA = "No se pudieron cargar los pedidos. Inténtelo nuevamente."
const VISTA_KEY = "admin-pedidos-vista"
const COLAS_VACIAS: ColasCounts = { sin_confirmar: 0, pago: 0, datos: 0, sin_factura: 0 }
/** Debounce del buscador: no manda un fetch por cada tecla. */
const DEBOUNCE_BUSQUEDA_MS = 350

function leerVistaGuardada(): Vista {
  try {
    const v = localStorage.getItem(VISTA_KEY)
    return v === "tablero" ? "tablero" : "lista"
  } catch {
    return "lista"
  }
}

const sinSuscripcion = () => () => {}

function guardarVista(v: Vista) {
  try {
    localStorage.setItem(VISTA_KEY, v)
  } catch {
    // Storage bloqueado (modo privado, cuota): la vista simplemente no se recuerda.
  }
}

export function PedidosShell({ initialItems, initialTotal, pageSize }: Props) {
  const router = useRouter()
  // La vista guardada se lee del lado del cliente; en el server (y al hidratar) vale "lista",
  // así no hay mismatch. La elección de esta sesión pisa a la guardada.
  const vistaGuardada = useSyncExternalStore(sinSuscripcion, leerVistaGuardada, () => "lista" as Vista)
  const [vistaElegida, setVista] = useState<Vista | null>(null)
  const vista = vistaElegida ?? vistaGuardada

  const [filtro, setFiltro] = useState<FiltroEstado>(FILTRO_TODOS)
  const [entrega, setEntrega] = useState<FiltroEntrega>(FILTRO_ENTREGA_TODOS)
  const [pago, setPago] = useState<FiltroPago>(FILTRO_PAGO_TODOS)
  const [cola, setCola] = useState<Cola | null>(null)
  const [qInput, setQInput] = useState("")
  const [q, setQ] = useState("")
  const [items, setItems] = useState(initialItems)
  const [total, setTotal] = useState(initialTotal)
  const [colas, setColas] = useState<ColasCounts>(COLAS_VACIAS)
  const [start, setStart] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState("")

  // Debounce: `q` (lo que dispara el fetch) sigue a `qInput` (lo que se ve tipeando) 350 ms
  // después de la última tecla.
  useEffect(() => {
    const id = setTimeout(() => setQ(qInput), DEBOUNCE_BUSQUEDA_MS)
    return () => clearTimeout(id)
  }, [qInput])

  const load = useCallback(async () => {
    // `no-store`: misma URL al volver a la lista; sin esto el navegador cachea el GET.
    const query = queryDeLista({
      estado: filtro,
      q,
      entrega,
      pago,
      cola,
      start,
      limit: pageSize,
      vista: vista === "tablero" ? "tablero" : undefined,
    })
    const res = await fetch(`/api/admin/pedidos?${query}`, { cache: "no-store" }).catch(() => null)
    const data = res?.ok ? ((await res.json().catch(() => null)) as ListaResponse | null) : null
    if (data && Array.isArray(data.items)) {
      setItems(data.items)
      setTotal(data.total)
      setColas(data.colas ?? COLAS_VACIAS)
      setError("")
    } else {
      // Red caída o respuesta !ok: no se borra lo que ya está en pantalla, sólo se avisa.
      setError(ERROR_CARGA)
    }
    setCargando(false)
  }, [cola, entrega, filtro, pago, pageSize, q, start, vista])

  // Carga al montar y al cambiar cualquier filtro, la página o la vista. El IIFE es el patrón de
  // ComprobantesShell (evita el falso positivo de set-state-in-effect).
  useEffect(() => {
    void (async () => {
      await load()
    })()
  }, [load])

  function cambiarVista(valor: string) {
    if (valor !== "lista" && valor !== "tablero") return
    const next = valor as Vista
    setVista(next)
    guardarVista(next)
  }

  function alternarCola(k: Cola) {
    setCargando(true)
    setCola((actual) => (actual === k ? null : k))
    setStart(0)
  }

  function cambiarFiltro(valor: string) {
    const next = OPCIONES_FILTRO.find((o) => o.value === valor)?.value as FiltroEstado | undefined
    if (!next || next === filtro) return
    setCargando(true)
    setFiltro(next)
    setStart(0)
  }

  function cambiarEntrega(valor: string) {
    setCargando(true)
    setEntrega(valor as FiltroEntrega)
    setStart(0)
  }

  function cambiarPago(valor: string) {
    setCargando(true)
    setPago(valor as FiltroPago)
    setStart(0)
  }

  function quitarFiltros() {
    setCargando(true)
    setFiltro(FILTRO_TODOS)
    setEntrega(FILTRO_ENTREGA_TODOS)
    setPago(FILTRO_PAGO_TODOS)
    setCola(null)
    setQInput("")
    setQ("")
    setStart(0)
  }

  const hayFiltrosActivos =
    filtro !== FILTRO_TODOS || entrega !== FILTRO_ENTREGA_TODOS || pago !== FILTRO_PAGO_TODOS || cola !== null || q !== ""

  function irAPagina(nuevoStart: number) {
    setCargando(true)
    setStart(nuevoStart)
  }

  const href = (p: PedidoListaDto) => `/admin/pedidos/${p.id}`

  const columns: TableColumn<PedidoListaDto>[] = [
    {
      key: "numero",
      header: "Pedido",
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
      render: (p) => (
        <>
          <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{pagoMetodoLabel(p.pagoMetodo)}</div>
          <div className="mt-0.5">
            <Badge tone={p.pagoEstado === "pagado" ? "success" : "warning"}>
              {p.pagoEstado === "pagado" ? "Pagado" : "Pago pendiente"}
            </Badge>
          </div>
        </>
      ),
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
            <span title={tituloRevision(p.motivoRevision)}>
              <Badge tone="warning">Revisar</Badge>
            </span>
          )}
          {p.pagoRevision && (
            <span title={PAGO_REVISION_INFO[p.pagoRevision].detalle}>
              <Badge tone="danger">{PAGO_REVISION_INFO[p.pagoRevision].label}</Badge>
            </span>
          )}
          {esSinFactura(p) && <Badge tone="neutral">Sin factura</Badge>}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      {/* El título "Pedidos" ya lo pone la página (server component); acá sólo el switch de vista. */}
      <div className="flex items-center justify-end gap-2">
        <SegmentedControl value={vista} onValueChange={cambiarVista} options={OPCIONES_VISTA} ariaLabel="Vista" />
      </div>

      <div className="flex flex-wrap items-stretch gap-2">
        <span className="self-center text-sm" style={{ color: "var(--ink-soft)" }}>Para atender</span>
        {ORDEN_COLAS.map((k) => {
          const n = colas[k]
          const info = COLAS_INFO[k]
          const activa = cola === k
          return (
            <button
              key={k}
              type="button"
              onClick={() => alternarCola(k)}
              aria-pressed={activa}
              className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm"
              style={{
                borderColor: activa ? "var(--blue, var(--ink))" : "var(--border)",
                boxShadow: activa ? "inset 0 0 0 1px var(--blue, var(--ink))" : undefined,
                background: "var(--card)",
              }}
            >
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: `var(--${info.severidad === "danger" ? "red" : info.severidad === "amber" ? "amber" : "blue"}, currentColor)` }}
              />
              <span className="font-semibold tabular-nums" style={{ color: n === 0 ? "var(--ink-faint)" : "var(--ink)" }}>
                {n}
              </span>
              <span style={{ color: "var(--ink-soft)" }}>{info.label}</span>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <div className="sm:col-span-1">
          <SearchInput
            value={qInput}
            onValueChange={(v) => { setQInput(v); setStart(0) }}
            onClear={() => { setQInput(""); setStart(0) }}
            placeholder="Buscar por número, cliente o email"
            aria-label="Buscar pedidos"
            className="w-full"
          />
        </div>
        <Select aria-label="Estado" value={filtro} onValueChange={cambiarFiltro} options={OPCIONES_FILTRO} />
        <Select aria-label="Entrega" value={entrega} onValueChange={cambiarEntrega} options={OPCIONES_ENTREGA} />
        <Select aria-label="Pago" value={pago} onValueChange={cambiarPago} options={OPCIONES_PAGO} />
      </div>

      {!items.length && !error && start === 0 ? (
        <EmptyState
          icon={<ShoppingBag size={28} strokeWidth={1.2} />}
          title={cargando ? "Cargando…" : "No hay pedidos para mostrar."}
          action={
            hayFiltrosActivos && !cargando ? (
              <Button variant="ghost" size="sm" onClick={quitarFiltros}>Quitar filtros</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {vista === "tablero" ? (
            <PedidosTablero items={items} onRecargar={() => void load()} />
          ) : (
            <Table<PedidoListaDto>
              columns={columns}
              rows={items}
              rowKey={(p) => p.id}
              onRowClick={(p) => router.push(href(p))}
              empty="No hay pedidos para mostrar."
            />
          )}
          {error && (
            <div className="flex flex-col items-center gap-2 pt-2" role="alert">
              <p className="text-xs" style={{ color: "var(--red)" }}>{error}</p>
              <Button variant="ghost" size="sm" onClick={() => { setCargando(true); void load() }}>
                <RefreshCw size={13} /> Reintentar
              </Button>
            </div>
          )}
          {vista === "lista" && (total > 0 || start > 0) && (
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
