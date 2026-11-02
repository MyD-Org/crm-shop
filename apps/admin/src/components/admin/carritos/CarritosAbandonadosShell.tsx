"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { RefreshCw, ShoppingCart } from "lucide-react"
import { Badge, Button, EmptyState, SearchInput, Select, Table, type TableColumn } from "@myd-org/ui"
import type { CarritoAbandonadoDto } from "@/lib/carritos-repo"
import { fmtFechaPedido, fmtMoneda } from "../pedidos/format"
import { textoRango } from "../pedidos/logica"
import {
  DIAS_DEFAULT,
  FILTRO_PEDIDO_TODOS,
  HORAS_DEFAULT,
  NOTA_MONTO,
  NOTA_SESION,
  OPCIONES_DIAS,
  OPCIONES_HORAS,
  OPCIONES_PEDIDO,
  ROTULO_MONTO,
  VACIO,
  nombreCliente,
  queryCarritos,
  resumenProductos,
  textoInactividad,
} from "./logica"

const PAGE_SIZE = 25
const ERROR_CARGA = "No se pudieron cargar los carritos abandonados. Inténtelo nuevamente."
/** Debounce del buscador: no manda un fetch por cada tecla. */
const DEBOUNCE_BUSQUEDA_MS = 350

interface ListaResponse {
  items: CarritoAbandonadoDto[]
  total: number
  montoTotalReferencial: number
}

export function CarritosAbandonadosShell() {
  const [horas, setHoras] = useState(HORAS_DEFAULT)
  const [dias, setDias] = useState(DIAS_DEFAULT)
  const [pedido, setPedido] = useState(FILTRO_PEDIDO_TODOS)
  const [qInput, setQInput] = useState("")
  const [q, setQ] = useState("")
  const [start, setStart] = useState(0)
  const [items, setItems] = useState<CarritoAbandonadoDto[]>([])
  const [total, setTotal] = useState(0)
  const [montoTotal, setMontoTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const id = setTimeout(() => setQ(qInput), DEBOUNCE_BUSQUEDA_MS)
    return () => clearTimeout(id)
  }, [qInput])

  const cargar = useCallback(async () => {
    const query = queryCarritos({ horas, dias, pedido, q, start, limit: PAGE_SIZE })
    const res = await fetch(`/api/admin/carritos?${query}`, { cache: "no-store" }).catch(() => null)
    const data = res?.ok ? ((await res.json().catch(() => null)) as ListaResponse | null) : null
    if (data && Array.isArray(data.items)) {
      setItems(data.items)
      setTotal(data.total)
      setMontoTotal(data.montoTotalReferencial ?? 0)
      setError("")
    } else {
      // Red caída o respuesta !ok: no se borra lo que ya está en pantalla, sólo se avisa.
      setError(ERROR_CARGA)
    }
    setCargando(false)
  }, [horas, dias, pedido, q, start])

  // El IIFE es el patrón de PedidosShell (evita el falso positivo de set-state-in-effect).
  useEffect(() => {
    void (async () => {
      await cargar()
    })()
  }, [cargar])

  function cambiar(set: (v: string) => void, valor: string) {
    setCargando(true)
    set(valor)
    setStart(0)
  }

  function quitarFiltros() {
    setCargando(true)
    setPedido(FILTRO_PEDIDO_TODOS)
    setQInput("")
    setQ("")
    setStart(0)
  }

  const hayFiltros = pedido !== FILTRO_PEDIDO_TODOS || q !== ""

  const columns: TableColumn<CarritoAbandonadoDto>[] = [
    {
      key: "cliente",
      header: "Cliente",
      render: (c) => (
        <>
          <div className="font-medium" style={{ color: "var(--ink)" }}>{nombreCliente(c)}</div>
          {c.nombre && c.email && <div className="text-xs" style={{ color: "var(--ink-faint)" }}>{c.email}</div>}
        </>
      ),
    },
    {
      key: "productos",
      header: "Productos",
      hideBelow: "md",
      render: (c) => (
        <ul className="text-xs" style={{ color: "var(--ink-soft)" }}>
          {resumenProductos(c.productos, c.lineas).map((linea, i) => (
            <li key={i}>{linea}</li>
          ))}
        </ul>
      ),
    },
    {
      key: "unidades",
      header: "Unidades",
      align: "right",
      hideBelow: "sm",
      className: "tabular-nums",
      render: (c) => <span style={{ color: "var(--ink)" }}>{c.unidades}</span>,
    },
    {
      key: "monto",
      header: "Monto referencial",
      align: "right",
      className: "tabular-nums",
      render: (c) => (
        <>
          <div style={{ color: "var(--ink)" }}>{fmtMoneda(c.montoReferencial)}</div>
          {c.faltantes > 0 && (
            <div className="text-xs" style={{ color: "var(--ink-faint)" }}>
              monto parcial ({c.faltantes} {c.faltantes === 1 ? "producto sin precio" : "productos sin precio"})
            </div>
          )}
        </>
      ),
    },
    {
      key: "desde",
      header: "Desde",
      hideBelow: "lg",
      className: "text-xs",
      render: (c) => (
        <span style={{ color: "var(--ink-soft)" }}>{c.conItemsDesde ? fmtFechaPedido(c.conItemsDesde) : "—"}</span>
      ),
    },
    {
      key: "actividad",
      header: "Última actividad",
      hideBelow: "sm",
      render: (c) => (
        <>
          <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{fmtFechaPedido(c.ultimaActividad)}</div>
          <div className="text-xs" style={{ color: "var(--ink-faint)" }}>Hace {textoInactividad(c.horasInactivo)}</div>
        </>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (c) =>
        c.pedidoPendiente ? (
          <div className="flex flex-col items-start gap-1">
            <Badge tone="warning">Pedido pendiente de pago</Badge>
            <Link
              href={`/admin/pedidos/${c.pedidoPendiente.id}`}
              className="text-xs tabular-nums hover:underline"
              style={{ color: "var(--blue)" }}
            >
              {c.pedidoPendiente.numeroTexto}
            </Link>
          </div>
        ) : (
          <Badge tone="neutral">Abandonado</Badge>
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
        Compradores que dejaron productos en el carrito y no volvieron. {NOTA_SESION}
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <SearchInput
          value={qInput}
          onValueChange={(v) => { setQInput(v); setStart(0) }}
          onClear={() => { setQInput(""); setStart(0) }}
          placeholder="Buscar por cliente o email"
          aria-label="Buscar carritos"
          className="w-full"
        />
        <Select
          aria-label="Inactividad"
          value={String(horas)}
          onValueChange={(v) => cambiar((x) => setHoras(Number(x)), v)}
          options={OPCIONES_HORAS}
        />
        <Select
          aria-label="Antigüedad"
          value={String(dias)}
          onValueChange={(v) => cambiar((x) => setDias(Number(x)), v)}
          options={OPCIONES_DIAS}
        />
        <Select aria-label="Pedido" value={pedido} onValueChange={(v) => cambiar(setPedido, v)} options={OPCIONES_PEDIDO} />
      </div>

      {total > 0 && (
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          {total} {total === 1 ? "carrito" : "carritos"} · Monto referencial total{" "}
          <span className="font-medium tabular-nums" style={{ color: "var(--ink)" }}>{fmtMoneda(montoTotal)}</span>
        </p>
      )}

      {!items.length && !error && start === 0 ? (
        <EmptyState
          icon={<ShoppingCart size={28} strokeWidth={1.2} />}
          title={cargando ? "Cargando…" : VACIO}
          action={
            hayFiltros && !cargando ? (
              <Button variant="ghost" size="sm" onClick={quitarFiltros}>Quitar filtros</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table<CarritoAbandonadoDto> columns={columns} rows={items} rowKey={(c) => c.clerkUserId} empty={VACIO} />
          <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
            {ROTULO_MONTO}. {NOTA_MONTO}
          </p>
          {error && (
            <div className="flex flex-col items-center gap-2 pt-2" role="alert">
              <p className="text-xs" style={{ color: "var(--red)" }}>{error}</p>
              <Button variant="ghost" size="sm" onClick={() => { setCargando(true); void cargar() }}>
                <RefreshCw size={13} /> Reintentar
              </Button>
            </div>
          )}
          {(total > 0 || start > 0) && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setCargando(true); setStart(Math.max(0, start - PAGE_SIZE)) }}
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
                onClick={() => { setCargando(true); setStart(start + PAGE_SIZE) }}
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
