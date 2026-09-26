"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw, UserRound } from "lucide-react"
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  SearchInput,
  Select,
  Table,
  TableSkeleton,
  type TableColumn,
} from "@myd-org/ui"
import type { ClienteTiendaDto } from "@/lib/clientes-tienda-repo"
import { textoRango } from "../pedidos/logica"
import { fmtFechaCliente } from "./format"
import {
  FILTROS_INICIALES,
  OPCIONES_ACCESO,
  OPCIONES_PEDIDOS,
  OPCIONES_VINCULO,
  etiquetaAcceso,
  etiquetaMetodo,
  etiquetaTipoCuenta,
  etiquetaVinculo,
  hayFiltros,
  mensajeVacio,
  opcionValida,
  queryDeLista,
  tonoAcceso,
  tonoVinculo,
  type FiltrosLista,
} from "./logica"

interface ListaResponse {
  items: ClienteTiendaDto[]
  total: number
}

interface Props {
  /** Primera página sin filtros, cargada por el server component. */
  initialItems: ClienteTiendaDto[]
  initialTotal: number
  /** Si la carga del server falló: el shell muestra el aviso y reintenta al montar. */
  initialError?: string
  pageSize: number
}

const ERROR_CARGA = "No se pudieron cargar los clientes de la tienda. Inténtelo nuevamente."
const DEBOUNCE_MS = 300

function errorDe(body: unknown): string | null {
  const error = (body as { error?: unknown } | null)?.error
  return typeof error === "string" && error.trim() !== "" ? error : null
}

export function ClientesTiendaShell({ initialItems, initialTotal, initialError = "", pageSize }: Props) {
  const [filtros, setFiltros] = useState<FiltrosLista>(FILTROS_INICIALES)
  const [busqueda, setBusqueda] = useState("")
  const [items, setItems] = useState(initialItems)
  const [total, setTotal] = useState(initialTotal)
  const [start, setStart] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(initialError)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    // `no-store`: misma URL al volver a la lista; sin esto el navegador cachea el GET.
    const res = await fetch(`/api/admin/clientes-tienda?${queryDeLista({ ...filtros, start, limit: pageSize })}`, {
      cache: "no-store",
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    if (res?.ok && data && Array.isArray((data as ListaResponse).items)) {
      setItems((data as ListaResponse).items)
      setTotal((data as ListaResponse).total)
      setError("")
    } else {
      // Red caída o respuesta !ok: no se borra lo que ya está en pantalla, sólo se avisa. Un
      // 4xx trae un {error} redactado para mostrar; un 5xx o la red, el texto genérico.
      setError(res && res.status < 500 ? (errorDe(data) ?? ERROR_CARGA) : ERROR_CARGA)
    }
    setCargando(false)
  }, [filtros, start, pageSize])

  // Carga al montar y al cambiar de filtro/página. El IIFE es el patrón de PedidosShell (evita
  // el falso positivo de set-state-in-effect).
  useEffect(() => {
    void (async () => {
      await load()
    })()
  }, [load])

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current)
  }, [])

  function aplicar(cambio: Partial<FiltrosLista>) {
    setCargando(true)
    setFiltros((f) => ({ ...f, ...cambio }))
    setStart(0)
  }

  function cambiarBusqueda(valor: string) {
    setBusqueda(valor)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      if (valor.trim() !== filtros.q.trim()) aplicar({ q: valor })
    }, DEBOUNCE_MS)
  }

  function limpiarBusqueda() {
    if (debounce.current) clearTimeout(debounce.current)
    setBusqueda("")
    if (filtros.q.trim() !== "") aplicar({ q: "" })
  }

  function irAPagina(nuevoStart: number) {
    setCargando(true)
    setStart(nuevoStart)
  }

  function actualizar() {
    setCargando(true)
    void load()
  }

  const secundario = { color: "var(--ink-faint)" }

  const columns: TableColumn<ClienteTiendaDto>[] = [
    {
      key: "nombre",
      header: "Nombre",
      render: (c) => (
        <span className="font-medium" style={{ color: "var(--ink)" }}>{c.nombre ?? "—"}</span>
      ),
    },
    {
      key: "email",
      header: "Email",
      hideBelow: "md",
      className: "text-xs",
      render: (c) => <span style={{ color: "var(--ink-soft)" }}>{c.email ?? "—"}</span>,
    },
    {
      key: "alta",
      header: "Alta",
      hideBelow: "lg",
      className: "text-xs tabular-nums",
      render: (c) => <span style={{ color: "var(--ink-soft)" }}>{fmtFechaCliente(c.altaEn)}</span>,
    },
    {
      key: "vinculo",
      header: "Vínculo",
      render: (c) => (
        <div className="flex flex-col gap-0.5">
          {c.vinculo.razonSocial && (
            <span className="text-sm" style={{ color: "var(--ink)" }}>{c.vinculo.razonSocial}</span>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <Badge tone={tonoVinculo(c.vinculo.estado)}>{etiquetaVinculo(c.vinculo.estado)}</Badge>
            {c.vinculo.estado === "vinculado" && etiquetaMetodo(c.vinculo.metodo) && (
              <span className="text-xs" style={secundario}>{etiquetaMetodo(c.vinculo.metodo)}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "tipoCuenta",
      header: "Tipo de cuenta",
      hideBelow: "lg",
      className: "text-xs",
      render: (c) => <span style={{ color: "var(--ink-soft)" }}>{etiquetaTipoCuenta(c.tipoCuenta)}</span>,
    },
    {
      key: "acceso",
      header: "Acceso a Facturación",
      hideBelow: "md",
      render: (c) => <Badge tone={tonoAcceso(c.acceso)}>{etiquetaAcceso(c.acceso)}</Badge>,
    },
    {
      key: "pedidos",
      header: "Pedidos",
      align: "right",
      className: "tabular-nums",
      render: (c) => <span style={{ color: "var(--ink)" }}>{c.pedidos}</span>,
    },
    {
      key: "ultimoPedido",
      header: "Último pedido",
      hideBelow: "lg",
      className: "text-xs tabular-nums",
      render: (c) => <span style={{ color: "var(--ink-soft)" }}>{fmtFechaCliente(c.ultimoPedidoEn)}</span>,
    },
  ]

  const vacio = mensajeVacio(hayFiltros(filtros))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput
          className="w-full sm:w-72"
          placeholder="Buscar por nombre o email"
          aria-label="Buscar por nombre o email"
          value={busqueda}
          onValueChange={cambiarBusqueda}
          onClear={limpiarBusqueda}
          maxLength={100}
        />
        <Select
          className="w-full sm:w-48"
          aria-label="Filtrar por vínculo"
          value={filtros.vinculo}
          onValueChange={(v) => {
            const valor = opcionValida(OPCIONES_VINCULO, v)
            if (valor && valor !== filtros.vinculo) aplicar({ vinculo: valor })
          }}
          options={OPCIONES_VINCULO}
        />
        <Select
          className="w-full sm:w-56"
          aria-label="Filtrar por acceso a Facturación"
          value={filtros.acceso}
          onValueChange={(v) => {
            const valor = opcionValida(OPCIONES_ACCESO, v)
            if (valor && valor !== filtros.acceso) aplicar({ acceso: valor })
          }}
          options={OPCIONES_ACCESO}
        />
        <Select
          className="w-full sm:w-44"
          aria-label="Filtrar por pedidos"
          value={filtros.pedidos}
          onValueChange={(v) => {
            const valor = opcionValida(OPCIONES_PEDIDOS, v)
            if (valor && valor !== filtros.pedidos) aplicar({ pedidos: valor })
          }}
          options={OPCIONES_PEDIDOS}
        />
        <Button variant="ghost" size="sm" onClick={actualizar} disabled={cargando}>
          <RefreshCw size={13} /> Actualizar
        </Button>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {cargando && !items.length ? (
        <TableSkeleton rows={5} />
      ) : !items.length && start === 0 ? (
        // `start === 0`: una página vacía más allá del final conserva el paginador para volver.
        error ? null : <EmptyState icon={<UserRound size={28} strokeWidth={1.2} />} title={vacio} />
      ) : (
        <>
          {cargando ? (
            <TableSkeleton rows={Math.min(items.length || 5, 10)} />
          ) : (
            <Table<ClienteTiendaDto>
              columns={columns}
              rows={items}
              rowKey={(c) => c.clerkUserId}
              empty={vacio}
            />
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
              <p className="text-xs tabular-nums" style={secundario} aria-live="polite">
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
