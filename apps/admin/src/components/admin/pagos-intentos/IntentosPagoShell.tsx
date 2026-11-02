"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CreditCard, RefreshCw } from "lucide-react"
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  SearchInput,
  SegmentedControl,
  Select,
  Table,
  type TableColumn,
} from "@myd-org/ui"
import type { IntentoListaDto, ResumenIntentosDto } from "@/lib/pagos-intentos-repo"
import { fmtFechaPedido, fmtMoneda } from "../pedidos/format"
import { textoRango } from "../pedidos/logica"
import { ResumenCuentas } from "./ResumenCuentas"
import {
  DIAS_DEFAULT,
  FILTRO_CLASE_TODAS,
  FILTRO_CUENTA_TODAS,
  FILTRO_TODOS,
  OPCIONES_CLASE,
  OPCIONES_PROVEEDOR,
  OPCIONES_VENTANA,
  SIN_DETALLE,
  etiquetaFila,
  motivoIntento,
  nombreCuenta,
  nombreProveedor,
  opcionesDeCuenta,
  queryIntentos,
  queryResumen,
  tonoFila,
} from "./logica"

interface Props {
  /** Sucursales del tenant (slug → nombre): rotulan las cuentas de cobro. */
  sucursales?: { slug: string; nombre: string }[]
}

const PAGE_SIZE = 25
const ERROR_CARGA = "No se pudieron cargar los intentos de pago. Inténtelo nuevamente."
const ERROR_RESUMEN = "No se pudo cargar el resumen de intentos de pago. Inténtelo nuevamente."
const VACIO = "No hay intentos de pago en el período"
/** Debounce del buscador: no manda un fetch por cada tecla. */
const DEBOUNCE_BUSQUEDA_MS = 350

function DetalleError({ f }: { f: IntentoListaDto }) {
  const motivo = f.fuente === "offline" ? null : motivoIntento(f as Parameters<typeof motivoIntento>[0])
  if (motivo === null) return <span style={{ color: "var(--ink-faint)" }}>—</span>
  if (motivo === SIN_DETALLE) return <span className="text-xs" style={{ color: "var(--ink-faint)" }}>{SIN_DETALLE}</span>
  return (
    <details className="text-xs">
      <summary className="cursor-pointer" style={{ color: "var(--ink-soft)" }}>
        {f.errorProveedor ? "Ver error del proveedor" : "Ver detalle"}
      </summary>
      <p className="mt-1 whitespace-pre-wrap break-words" style={{ color: "var(--ink)" }}>{motivo}</p>
    </details>
  )
}

export function IntentosPagoShell({ sucursales = [] }: Props) {
  const [dias, setDias] = useState(DIAS_DEFAULT)
  const [proveedor, setProveedor] = useState(FILTRO_TODOS)
  const [cuenta, setCuenta] = useState(FILTRO_CUENTA_TODAS)
  const [clase, setClase] = useState(FILTRO_CLASE_TODAS)
  const [qInput, setQInput] = useState("")
  const [q, setQ] = useState("")
  const [start, setStart] = useState(0)
  const [items, setItems] = useState<IntentoListaDto[]>([])
  const [total, setTotal] = useState(0)
  const [resumen, setResumen] = useState<ResumenIntentosDto | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState("")
  const [errorResumen, setErrorResumen] = useState("")

  const nombresCuenta = useMemo(() => new Map(sucursales.map((s) => [s.slug, s.nombre])), [sucursales])

  useEffect(() => {
    const id = setTimeout(() => setQ(qInput), DEBOUNCE_BUSQUEDA_MS)
    return () => clearTimeout(id)
  }, [qInput])

  const cargarResumen = useCallback(async () => {
    const res = await fetch(`/api/admin/pagos-intentos/resumen?${queryResumen(dias)}`, { cache: "no-store" }).catch(() => null)
    const data = res?.ok ? ((await res.json().catch(() => null)) as ResumenIntentosDto | null) : null
    if (data && Array.isArray(data.cuentas)) {
      setResumen(data)
      setErrorResumen("")
    } else {
      setErrorResumen(ERROR_RESUMEN)
    }
  }, [dias])

  const cargarLista = useCallback(async () => {
    const query = queryIntentos({ dias, proveedor, cuenta, clase, q, start, limit: PAGE_SIZE })
    const res = await fetch(`/api/admin/pagos-intentos?${query}`, { cache: "no-store" }).catch(() => null)
    const data = res?.ok ? ((await res.json().catch(() => null)) as { items: IntentoListaDto[]; total: number } | null) : null
    if (data && Array.isArray(data.items)) {
      setItems(data.items)
      setTotal(data.total)
      setError("")
    } else {
      // Red caída o respuesta !ok: no se borra lo que ya está en pantalla, sólo se avisa.
      setError(ERROR_CARGA)
    }
    setCargando(false)
  }, [dias, proveedor, cuenta, clase, q, start])

  // El IIFE es el patrón de PedidosShell (evita el falso positivo de set-state-in-effect).
  useEffect(() => {
    void (async () => {
      await cargarResumen()
    })()
  }, [cargarResumen])
  useEffect(() => {
    void (async () => {
      await cargarLista()
    })()
  }, [cargarLista])

  function cambiar<T>(set: (v: T) => void, valor: T) {
    setCargando(true)
    set(valor)
    setStart(0)
  }

  function quitarFiltros() {
    setCargando(true)
    setProveedor(FILTRO_TODOS)
    setCuenta(FILTRO_CUENTA_TODAS)
    setClase(FILTRO_CLASE_TODAS)
    setQInput("")
    setQ("")
    setStart(0)
  }

  const hayFiltros =
    proveedor !== FILTRO_TODOS || cuenta !== FILTRO_CUENTA_TODAS || clase !== FILTRO_CLASE_TODAS || q !== ""
  const opcionesCuenta = opcionesDeCuenta(resumen?.cuentas.map((c) => c.cuenta).filter((c) => c !== "sin_cuenta") ?? [], nombresCuenta)
  const href = (f: IntentoListaDto) => `/admin/pedidos/${f.pedidoId}`

  const columns: TableColumn<IntentoListaDto>[] = [
    {
      key: "pedido",
      header: "Pedido",
      render: (f) => (
        <>
          <Link href={href(f)} className="font-medium tabular-nums hover:underline" style={{ color: "var(--ink)" }}>
            {f.pedidoNumero}
          </Link>
          <div className="text-xs" style={{ color: "var(--ink-faint)" }}>{fmtFechaPedido(f.fecha)}</div>
        </>
      ),
    },
    {
      key: "cliente",
      header: "Cliente",
      hideBelow: "md",
      render: (f) => (
        <>
          <div style={{ color: "var(--ink)" }}>{f.clienteNombre ?? "—"}</div>
          {f.clienteEmail && <div className="text-xs" style={{ color: "var(--ink-faint)" }}>{f.clienteEmail}</div>}
        </>
      ),
    },
    {
      key: "medio",
      header: "Medio y cuenta",
      hideBelow: "sm",
      render: (f) => (
        <>
          <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{nombreProveedor(f.proveedor)}</div>
          {f.fuente === "intento" && (
            <div className="text-xs" style={{ color: "var(--ink-faint)" }}>
              {nombreCuenta(f.cuenta ?? f.cuentaPrevista, nombresCuenta)}
              {f.cuenta && f.cuentaPrevista && f.cuenta !== f.cuentaPrevista
                ? ` (prevista: ${nombreCuenta(f.cuentaPrevista, nombresCuenta)})`
                : ""}
            </div>
          )}
        </>
      ),
    },
    { key: "estado", header: "Estado", render: (f) => <Badge tone={tonoFila(f)}>{etiquetaFila(f)}</Badge> },
    { key: "motivo", header: "Motivo", hideBelow: "sm", render: (f) => <DetalleError f={f} /> },
    {
      key: "monto",
      header: "Monto",
      align: "right",
      hideBelow: "lg",
      className: "tabular-nums",
      render: (f) => <span style={{ color: "var(--ink)" }}>{f.monto === null ? "—" : fmtMoneda(f.monto)}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Resultado de los cobros en línea por medio y cuenta, con la causa de cada falla.
        </p>
        <SegmentedControl
          value={String(dias)}
          onValueChange={(v) => cambiar(setDias, Number(v))}
          options={OPCIONES_VENTANA}
          ariaLabel="Período"
        />
      </div>

      {errorResumen && <Alert tone="danger">{errorResumen}</Alert>}
      {resumen && <ResumenCuentas cuentas={resumen.cuentas} offline={resumen.offline} nombresCuenta={nombresCuenta} />}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <SearchInput
          value={qInput}
          onValueChange={(v) => { setQInput(v); setStart(0) }}
          onClear={() => { setQInput(""); setStart(0) }}
          placeholder="Buscar por número, cliente o email"
          aria-label="Buscar intentos de pago"
          className="w-full"
        />
        <Select aria-label="Medio" value={proveedor} onValueChange={(v) => cambiar(setProveedor, v)} options={OPCIONES_PROVEEDOR} />
        <Select aria-label="Cuenta" value={cuenta} onValueChange={(v) => cambiar(setCuenta, v)} options={opcionesCuenta} />
        <Select aria-label="Estado" value={clase} onValueChange={(v) => cambiar(setClase, v)} options={OPCIONES_CLASE} />
      </div>

      {!items.length && !error && start === 0 ? (
        <EmptyState
          icon={<CreditCard size={28} strokeWidth={1.2} />}
          title={cargando ? "Cargando…" : VACIO}
          action={
            hayFiltros && !cargando ? (
              <Button variant="ghost" size="sm" onClick={quitarFiltros}>Quitar filtros</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table<IntentoListaDto> columns={columns} rows={items} rowKey={(f) => `${f.fuente}:${f.id}`} empty={VACIO} />
          {error && (
            <div className="flex flex-col items-center gap-2 pt-2" role="alert">
              <p className="text-xs" style={{ color: "var(--red)" }}>{error}</p>
              <Button variant="ghost" size="sm" onClick={() => { setCargando(true); void cargarLista() }}>
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
