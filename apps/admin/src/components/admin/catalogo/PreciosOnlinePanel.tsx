"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Alert, Badge, Button, Checkbox, EmptyState, SearchInput, Select, Table, Tabs, Input, type TableColumn } from "@myd-org/ui"
import type { AlertasPrecios } from "@/lib/precios-online-costos"
import type { EstadoGrilla, FilaGrilla, ReferenciaAlegra } from "@/lib/precios-online-grilla"
import type { ListaDto } from "@/lib/precios-online-repo"
import { HistorialPanel } from "./HistorialPanel"
import { ListasPrecioPanel } from "./ListasPrecioPanel"
import { RetenidosPanel } from "./RetenidosPanel"
import { TEXTOS, fmtCoef, fmtPrecio, textoOrigen } from "./precios-online-textos"
import { api, ErrorApi, type CategoriaDto } from "./tipos"

interface Props {
  categorias: CategoriaDto[]
}

type Sub = "productos" | "listas" | "retenidos" | "historial"
const PAGINA = 50
const TODOS = "todos"
const TONO_ESTADO: Record<EstadoGrilla, "success" | "warning" | "danger" | "info" | "neutral"> = {
  ok: "success",
  "sin-costo": "danger",
  "sin-precio": "warning",
  retenido: "warning",
  nuevo: "info",
}

/**
 * Sección "Precios online" del catálogo: grilla paginada en servidor con costo, precio de cada
 * lista, coeficiente efectivo y su ORIGEN (general / categoría / marca), alertas de pendientes y
 * las solapas de listas, retenidos e historial. Los precios de las listas de Alegra aparecen solo
 * como referencia informativa, agrupados por cuenta.
 */
export function PreciosOnlinePanel({ categorias }: Props) {
  const [sub, setSub] = useState<Sub>("productos")
  const [alertas, setAlertas] = useState<AlertasPrecios | null>(null)
  const [listas, setListas] = useState<ListaDto[]>([])
  const [version, setVersion] = useState(0)

  const recargarAlertas = useCallback(async () => {
    try {
      const [a, l] = await Promise.all([
        api<{ alertas: AlertasPrecios }>("/api/admin/precios-online/alertas"),
        api<{ listas: ListaDto[] }>("/api/admin/precios-online/listas"),
      ])
      setAlertas(a.alertas)
      setListas(l.listas)
    } catch {
      /* los paneles muestran su propio error de carga */
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await recargarAlertas()
    })()
  }, [recargarAlertas, version])

  const [estadoInicial, setEstadoInicial] = useState<{ estado: EstadoGrilla | ""; n: number }>({ estado: "", n: 0 })
  const alCambio = () => setVersion((v) => v + 1)

  const sinPendientes = alertas && alertas.sinCosto + alertas.sinPrecio + alertas.nuevosSinRevisar + alertas.retenidos === 0

  const irAGrilla = (estado: EstadoGrilla) => {
    setEstadoInicial((p) => ({ estado, n: p.n + 1 }))
    setSub("productos")
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>{TEXTOS.ayudaGeneral}</p>

      {alertas && (
        <section className="flex flex-wrap items-center gap-2" aria-label="Pendientes">
          {sinPendientes ? (
            <span className="text-sm" style={{ color: "var(--ink-soft)" }}>{TEXTOS.sinPendientes}</span>
          ) : (
            <>
              <Alerta etiqueta={TEXTOS.alertas.sinCosto} n={alertas.sinCosto} tono="danger" onClick={() => irAGrilla("sin-costo")} />
              <Alerta etiqueta={TEXTOS.alertas.sinPrecio} n={alertas.sinPrecio} tono="warning" onClick={() => irAGrilla("sin-precio")} />
              <Alerta etiqueta={TEXTOS.alertas.nuevos} n={alertas.nuevosSinRevisar} tono="info" onClick={() => irAGrilla("nuevo")} />
              <Alerta etiqueta={TEXTOS.alertas.retenidos} n={alertas.retenidos} tono="warning" onClick={() => setSub("retenidos")} />
            </>
          )}
        </section>
      )}

      <Tabs
        variant="underline"
        value={sub}
        onValueChange={(v) => setSub(v as Sub)}
        items={[
          { value: "productos", label: "Productos" },
          { value: "listas", label: "Listas" },
          { value: "retenidos", label: alertas?.retenidos ? `Retenidos (${alertas.retenidos})` : "Retenidos" },
          { value: "historial", label: "Historial" },
        ]}
      />

      {sub === "productos" && (
        <GrillaPrecios key={`${estadoInicial.n}-${version}`} categorias={categorias} listas={listas} estadoInicial={estadoInicial.estado} />
      )}
      {sub === "listas" && <ListasPrecioPanel categorias={categorias} onCambio={alCambio} />}
      {sub === "retenidos" && <RetenidosPanel onCambio={alCambio} />}
      {sub === "historial" && <HistorialPanel onCambio={alCambio} />}
    </div>
  )
}

function Alerta({ etiqueta, n, tono, onClick }: { etiqueta: string; n: number; tono: "danger" | "warning" | "info"; onClick: () => void }) {
  if (n === 0) return null
  return (
    <button type="button" onClick={onClick} className="cursor-pointer" aria-label={`${etiqueta}: ${n}`}>
      <Badge tone={tono}>
        {etiqueta}: {n}
      </Badge>
    </button>
  )
}

interface GrillaProps {
  categorias: CategoriaDto[]
  listas: ListaDto[]
  estadoInicial: EstadoGrilla | ""
}

function GrillaPrecios({ categorias, listas, estadoInicial }: GrillaProps) {
  const [q, setQ] = useState("")
  const [marca, setMarca] = useState("")
  const [categoria, setCategoria] = useState("")
  const [estado, setEstado] = useState<EstadoGrilla | "">(estadoInicial)
  const [orden, setOrden] = useState<"nombre" | "precio" | "costo">("nombre")
  const [start, setStart] = useState(0)
  const [data, setData] = useState<{ items: FilaGrilla[]; total: number } | null>(null)
  const [error, setError] = useState("")
  const [cargando, setCargando] = useState(false)
  const [verReferencia, setVerReferencia] = useState(false)

  // Búsqueda con demora: no se consulta en cada tecla.
  const [consulta, setConsulta] = useState({ q: "", marca: "" })
  useEffect(() => {
    const t = setTimeout(() => {
      setConsulta({ q, marca })
      setStart(0)
    }, 300)
    return () => clearTimeout(t)
  }, [q, marca])

  useEffect(() => {
    let cancelado = false
    void (async () => {
      setCargando(true)
      const p = new URLSearchParams({ start: String(start), limit: String(PAGINA), orden })
      if (consulta.q) p.set("q", consulta.q)
      if (consulta.marca) p.set("marca", consulta.marca)
      if (categoria) p.set("categoria", categoria)
      if (estado) p.set("estado", estado)
      try {
        const r = await api<{ items: FilaGrilla[]; total: number }>(`/api/admin/catalogo/precios-online?${p}`)
        if (!cancelado) {
          setData(r)
          setError("")
        }
      } catch (err) {
        if (!cancelado) setError(err instanceof ErrorApi ? err.message : TEXTOS.grilla.errorCarga)
      } finally {
        if (!cancelado) setCargando(false)
      }
    })()
    return () => {
      cancelado = true
    }
  }, [consulta, categoria, estado, orden, start])

  const listasActivas = useMemo(() => listas.filter((l) => l.activa), [listas])
  // Cuentas de Alegra presentes en la página, para agrupar las columnas de referencia.
  const cuentas = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of data?.items ?? []) for (const r of f.referenciaAlegra) m.set(r.cuenta, r.cuenta)
    return [...m.keys()].sort()
  }, [data])

  const columnas: TableColumn<FilaGrilla>[] = [
    {
      key: "producto",
      header: TEXTOS.grilla.producto,
      render: (f) => (
        <span>
          <span className="font-medium">{f.nombre}</span>
          <span className="block text-xs" style={{ color: "var(--ink-faint)" }}>
            {[f.code, f.marca, f.categoriaNombre].filter(Boolean).join(" · ")}
          </span>
        </span>
      ),
    },
    { key: "costo", header: TEXTOS.grilla.costo, align: "right", className: "tabular-nums", render: (f) => fmtPrecio(f.costo) },
    ...listasActivas.map(
      (l): TableColumn<FilaGrilla> => ({
        key: `lista-${l.id}`,
        header: (
          <span>
            {l.nombre}
            {l.esReferencia ? ` (${TEXTOS.listas.referencia.toLowerCase()})` : ""}
          </span>
        ),
        align: "right",
        render: (f) => {
          const p = f.precios.find((x) => x.listaId === l.id)
          if (!p) return "—"
          return (
            <span className="tabular-nums">
              {fmtPrecio(p.precio)}
              <span className="block text-xs" style={{ color: "var(--ink-soft)" }}>
                × {fmtCoef(p.coeficiente)} · {textoOrigen(p.origen)}
              </span>
            </span>
          )
        },
      }),
    ),
    ...(verReferencia
      ? cuentas.map(
          (cuenta): TableColumn<FilaGrilla> => ({
            key: `ref-${cuenta}`,
            header: (
              <span>
                {TEXTOS.grilla.referenciaTitulo}
                <span className="block text-xs font-normal">{cuenta}</span>
              </span>
            ),
            render: (f) => <ReferenciaCuenta refs={f.referenciaAlegra.filter((r) => r.cuenta === cuenta)} />,
          }),
        )
      : []),
    {
      key: "estado",
      header: TEXTOS.grilla.estadoCol,
      render: (f) => <Badge tone={TONO_ESTADO[f.estado]}>{TEXTOS.estados[f.estado]}</Badge>,
    },
  ]

  const total = data?.total ?? 0
  return (
    <section className="flex flex-col gap-4" aria-label={TEXTOS.titulo}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <SearchInput value={q} onValueChange={setQ} onClear={() => setQ("")} placeholder={TEXTOS.grilla.buscar} aria-label={TEXTOS.grilla.buscar} />
        </div>
        <Input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder={TEXTOS.grilla.marca} aria-label={TEXTOS.grilla.marca} className="w-40" />
        <Select
          value={categoria || TODOS}
          onValueChange={(v) => {
            setCategoria(v === TODOS ? "" : v)
            setStart(0)
          }}
          aria-label={TEXTOS.grilla.categoria}
          options={[
            { value: TODOS, label: TEXTOS.grilla.todasCategorias },
            { value: "sin", label: TEXTOS.grilla.sinCategoria },
            ...categorias.map((c) => ({ value: c.id, label: `${"— ".repeat(Math.max(0, c.nivel - 1))}${c.nombre}` })),
          ]}
        />
        <Select
          value={estado || TODOS}
          onValueChange={(v) => {
            setEstado(v === TODOS ? "" : (v as EstadoGrilla))
            setStart(0)
          }}
          aria-label={TEXTOS.grilla.estado}
          options={[{ value: TODOS, label: TEXTOS.grilla.todosEstados }, ...Object.entries(TEXTOS.estados).map(([value, label]) => ({ value, label }))]}
        />
        <Select
          value={orden}
          onValueChange={(v) => setOrden(v as "nombre" | "precio" | "costo")}
          aria-label="Ordenar por"
          options={[
            { value: "nombre", label: "Ordenar por nombre" },
            { value: "precio", label: "Ordenar por precio" },
            { value: "costo", label: "Ordenar por costo" },
          ]}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={verReferencia} onCheckedChange={setVerReferencia} aria-label={TEXTOS.grilla.mostrarReferencia} />
        {TEXTOS.grilla.mostrarReferencia}
        {verReferencia && <span style={{ color: "var(--ink-soft)" }}>· {TEXTOS.grilla.referenciaAyuda}</span>}
      </label>

      {error && <Alert tone="danger">{error}</Alert>}
      {listasActivas.length === 0 && data && <Alert tone="neutral">{TEXTOS.grilla.sinListas}</Alert>}
      {data && data.items.length === 0 ? (
        <EmptyState title={TEXTOS.grilla.sinResultados} />
      ) : (
        <Table columns={columnas} rows={data?.items ?? []} rowKey={(f) => f.alegraId} />
      )}
      <div className="flex items-center justify-between gap-2 text-sm">
        <span style={{ color: "var(--ink-soft)" }}>
          {cargando ? TEXTOS.grilla.cargando : total === 0 ? "" : `${start + 1}–${Math.min(start + PAGINA, total)} de ${total}`}
        </span>
        <span className="flex gap-2">
          <Button size="sm" variant="outline" disabled={start === 0} onClick={() => setStart((s) => Math.max(0, s - PAGINA))}>
            {TEXTOS.grilla.anterior}
          </Button>
          <Button size="sm" variant="outline" disabled={start + PAGINA >= total} onClick={() => setStart((s) => s + PAGINA)}>
            {TEXTOS.grilla.siguiente}
          </Button>
        </span>
      </div>
    </section>
  )
}

/** Precios de las listas de Alegra de UNA cuenta, solo como referencia (no intervienen en el cálculo). */
function ReferenciaCuenta({ refs }: { refs: ReferenciaAlegra[] }) {
  if (refs.length === 0) return <span style={{ color: "var(--ink-faint)" }}>—</span>
  return (
    <ul className="text-xs tabular-nums" style={{ color: "var(--ink-soft)" }}>
      {refs.map((r) => (
        <li key={`${r.listaId}-${r.listaNombre}`}>
          {r.listaNombre}: {fmtPrecio(r.precio)}
        </li>
      ))}
    </ul>
  )
}
