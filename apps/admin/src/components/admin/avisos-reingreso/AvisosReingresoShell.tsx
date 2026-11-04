"use client"

import { useCallback, useEffect, useState } from "react"
import { BellRing, RefreshCw } from "lucide-react"
import { Badge, Button, Dialog, EmptyState, Select, Table, type TableColumn } from "@myd-org/ui"
import type { DemandaProductoDto, InteresadoDto } from "@/lib/avisos-reingreso-repo"
import { fmtFechaPedido } from "../pedidos/format"
import { textoRango } from "../pedidos/logica"
import {
  FILTRO_AVISOS_TODOS,
  OPCIONES_FILTRO,
  SIN_INTERESADOS,
  VACIO,
  enlaceWhatsapp,
  queryAvisos,
  queryInteresados,
  textoPersonas,
} from "./logica"

const PAGE_SIZE = 50
const ERROR_CARGA = "No se pudieron cargar los avisos de stock. Inténtelo nuevamente."
const ERROR_INTERESADOS = "No se pudieron cargar las personas. Inténtelo nuevamente."

interface ListaResponse {
  items: DemandaProductoDto[]
  total: number
}

// Pestaña "Avisos de stock": productos agotados que la gente espera ("Avisarme cuando ingrese"),
// del más pedido al menos pedido. Sirve para decidir qué encargar a pedido.
export function AvisosReingresoShell() {
  const [filtro, setFiltro] = useState(FILTRO_AVISOS_TODOS)
  const [start, setStart] = useState(0)
  const [items, setItems] = useState<DemandaProductoDto[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState("")

  const [abierto, setAbierto] = useState<DemandaProductoDto | null>(null)
  const [personas, setPersonas] = useState<InteresadoDto[] | null>(null)
  const [errorPersonas, setErrorPersonas] = useState("")

  const cargar = useCallback(async () => {
    const query = queryAvisos({ filtro, start, limit: PAGE_SIZE })
    const res = await fetch(`/api/admin/avisos-reingreso?${query}`, { cache: "no-store" }).catch(() => null)
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
  }, [filtro, start])

  // El IIFE es el patrón de PedidosShell (evita el falso positivo de set-state-in-effect).
  useEffect(() => {
    void (async () => {
      await cargar()
    })()
  }, [cargar])

  async function abrir(producto: DemandaProductoDto) {
    setAbierto(producto)
    setPersonas(null)
    setErrorPersonas("")
    const res = await fetch(`/api/admin/avisos-reingreso?${queryInteresados(producto.alegraId)}`, {
      cache: "no-store",
    }).catch(() => null)
    const data = res?.ok ? ((await res.json().catch(() => null)) as { items: InteresadoDto[] } | null) : null
    if (data && Array.isArray(data.items)) setPersonas(data.items)
    else setErrorPersonas(ERROR_INTERESADOS)
  }

  function cambiarFiltro(valor: string) {
    setCargando(true)
    setFiltro(valor)
    setStart(0)
  }

  const columns: TableColumn<DemandaProductoDto>[] = [
    {
      key: "producto",
      header: "Producto",
      render: (p) => (
        <>
          <div className="font-medium" style={{ color: "var(--ink)" }}>{p.nombre}</div>
          {p.marca && <div className="text-xs" style={{ color: "var(--ink-faint)" }}>{p.marca}</div>}
        </>
      ),
    },
    {
      key: "interesados",
      header: "Interesados",
      align: "right",
      className: "tabular-nums",
      render: (p) => <span style={{ color: "var(--ink)" }}>{p.interesados}</span>,
    },
    {
      key: "unidades",
      header: "Unidades",
      align: "right",
      hideBelow: "sm",
      className: "tabular-nums",
      render: (p) => <span style={{ color: "var(--ink)" }}>{p.unidades}</span>,
    },
    {
      key: "encargar",
      header: "Quieren encargarlo",
      align: "right",
      hideBelow: "sm",
      className: "tabular-nums",
      render: (p) => <span style={{ color: "var(--ink)" }}>{p.quierenEncargar}</span>,
    },
    {
      key: "ultimo",
      header: "Último pedido de aviso",
      hideBelow: "md",
      className: "text-xs",
      render: (p) => <span style={{ color: "var(--ink-soft)" }}>{fmtFechaPedido(p.ultimoPedido)}</span>,
    },
    {
      key: "accion",
      header: "",
      align: "right",
      render: (p) => (
        <Button variant="ghost" size="sm" onClick={() => void abrir(p)}>Ver interesados</Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
        Productos sin stock que los visitantes esperan. Úselo para decidir qué encargar a pedido.
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <Select aria-label="Filtro" value={filtro} onValueChange={cambiarFiltro} options={OPCIONES_FILTRO} />
      </div>

      {total > 0 && (
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          {total} {total === 1 ? "producto" : "productos"}
        </p>
      )}

      {!items.length && !error && start === 0 ? (
        <EmptyState
          icon={<BellRing size={28} strokeWidth={1.2} />}
          title={cargando ? "Cargando…" : VACIO}
          action={
            filtro !== FILTRO_AVISOS_TODOS && !cargando ? (
              <Button variant="ghost" size="sm" onClick={() => cambiarFiltro(FILTRO_AVISOS_TODOS)}>Quitar filtros</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table<DemandaProductoDto>
            columns={columns}
            rows={items}
            rowKey={(p) => p.alegraId}
            empty={VACIO}
            onRowClick={(p) => void abrir(p)}
          />
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

      <Dialog
        open={abierto !== null}
        onOpenChange={(o) => { if (!o) setAbierto(null) }}
        title={abierto?.nombre ?? ""}
        description={abierto ? `${textoPersonas(abierto.interesados)} esperan este producto` : undefined}
        size="lg"
      >
        {errorPersonas ? (
          <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>{errorPersonas}</p>
        ) : personas === null ? (
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>Cargando…</p>
        ) : personas.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>{SIN_INTERESADOS}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {personas.map((p) => {
              const wa = p.whatsapp ? enlaceWhatsapp(p.whatsapp) : null
              return (
                <li key={p.id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`mailto:${p.email}`} className="text-sm font-medium hover:underline" style={{ color: "var(--blue)" }}>
                      {p.email}
                    </a>
                    {p.quiereEncargar && <Badge tone="info">Quiere encargarlo</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 text-xs" style={{ color: "var(--ink-soft)" }}>
                    {p.whatsapp && (
                      wa ? (
                        <a href={wa} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--blue)" }}>
                          WhatsApp {p.whatsapp}
                        </a>
                      ) : (
                        <span>WhatsApp {p.whatsapp}</span>
                      )
                    )}
                    <span>{p.cantidad} {p.cantidad === 1 ? "unidad" : "unidades"}</span>
                    <span>{fmtFechaPedido(p.creadoEn)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Dialog>
    </div>
  )
}
