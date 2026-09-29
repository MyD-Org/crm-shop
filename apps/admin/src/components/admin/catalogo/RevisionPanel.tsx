"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Badge, Button, EmptyState, Table, type TableColumn } from "@myd-org/ui"
import type { ItemRevisar, DuplicadoRevisar } from "@/lib/alegra-sync-cuenta"
import type { ProductoSoloEnCuenta, RevisionCuenta } from "@/lib/catalogo-revision"
import { api, ErrorApi, fmtFechaHora, stockDe } from "./tipos"

interface Props {
  /** Abre Productos con esta búsqueda (el editor de overlay vive ahí). */
  onVerProducto: (busqueda: string) => void
}

const ESTADO_SYNC: Record<string, string> = { ok: "Correcta", parcial: "Incompleta", error: "Con error" }

/**
 * Solapa "Revisión" (cuentas de Alegra secundarias). Dos bloques por cuenta:
 *  - "Códigos a revisar": SOLO errores de carga de la última sincronización (código duplicado o
 *    faltante). Esos productos no entran a la tienda hasta que se corrigen en Alegra.
 *  - "Productos solo en <cuenta>": informativo; existen únicamente en esa cuenta y se editan desde
 *    Productos como cualquier otro.
 */
export function RevisionPanel({ onVerProducto }: Props) {
  const [cuentas, setCuentas] = useState<RevisionCuenta[] | null>(null)
  const [error, setError] = useState("")

  const cargar = useCallback(async () => {
    try {
      setCuentas((await api<{ cuentas: RevisionCuenta[] }>("/api/admin/catalogo/revision")).cuentas)
      setError("")
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos cargar la revisión del catálogo.")
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await cargar()
    })()
  }, [cargar])

  if (error) {
    return (
      <div
        className="flex items-center justify-between gap-2 rounded-[var(--radius)] p-3 text-sm"
        style={{ background: "var(--red-soft)", color: "var(--red)" }}
        role="alert"
      >
        <span>{error}</span>
        <Button variant="ghost" size="sm" onClick={() => void cargar()}>
          <RefreshCw size={13} /> Reintentar
        </Button>
      </div>
    )
  }
  if (!cuentas) return <p className="text-sm" style={{ color: "var(--ink-faint)" }}>Cargando…</p>
  if (cuentas.length === 0) {
    return (
      <EmptyState
        title="No hay cuentas de Alegra adicionales"
        description="Cuando una sucursal tenga su propia cuenta de Alegra, acá verá los códigos a revisar y los productos que solo existen en ella."
      />
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {cuentas.map((c) => (
        <CuentaRevision key={c.slug} cuenta={c} onVerProducto={onVerProducto} />
      ))}
    </div>
  )
}

function CuentaRevision({ cuenta, onVerProducto }: { cuenta: RevisionCuenta; onVerProducto: (busqueda: string) => void }) {
  const r = cuenta.resumen
  const etiqueta = cuenta.sucursal ?? cuenta.nombre

  const columnasDuplicados: TableColumn<DuplicadoRevisar>[] = [
    { key: "codigo", header: "Código", render: (d) => <span className="font-medium">{d.codigo}</span> },
    {
      key: "en",
      header: "Dónde se repite",
      render: (d) => (
        <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
          {d.principal.length > 1 ? `${d.principal.length} productos en la cuenta principal` : ""}
          {d.principal.length > 1 && d.secundaria.length > 1 ? " · " : ""}
          {d.secundaria.length > 1 ? `${d.secundaria.length} productos en ${etiqueta}` : ""}
          {d.secundaria.length === 1 && d.principal.length <= 1 ? `1 producto en ${etiqueta}` : ""}
        </span>
      ),
    },
    {
      key: "nombres",
      header: "Productos",
      hideBelow: "md",
      render: (d) => (
        <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
          {d.secundaria.map((s) => s.nombre).filter(Boolean).join(" · ")}
        </span>
      ),
    },
  ]

  const columnasSinCodigo: TableColumn<ItemRevisar>[] = [
    { key: "nombre", header: "Producto", render: (i) => <span className="font-medium">{i.nombre || "(sin nombre)"}</span> },
    {
      key: "id",
      header: "Identificador en Alegra",
      hideBelow: "sm",
      render: (i) => <span className="text-xs tabular-nums" style={{ color: "var(--ink-faint)" }}>{i.alegraId}</span>,
    },
  ]

  const columnasSolo: TableColumn<ProductoSoloEnCuenta>[] = [
    {
      key: "producto",
      header: "Producto",
      render: (p) => (
        <>
          <div className="font-medium" style={{ color: "var(--ink)" }}>{p.nombre}</div>
          <div className="text-xs" style={{ color: "var(--ink-faint)" }}>{p.code ? `SKU ${p.code}` : "Sin código"}</div>
        </>
      ),
    },
    {
      key: "stock",
      header: "Stock",
      align: "right",
      className: "tabular-nums text-xs",
      render: (p) => {
        const s = stockDe(p.stock)
        return <span style={{ color: s?.hay ? "var(--ink-soft)" : "var(--ink-faint)" }}>{s ? s.texto : "Sin dato"}</span>
      },
    },
    {
      key: "estado",
      header: "Estado",
      render: (p) =>
        !p.activo ? (
          <Badge tone="neutral">{p.adoptado ? "Sin stock (inactivo en la cuenta principal)" : "No disponible"}</Badge>
        ) : p.adoptado ? (
          <Badge tone="warning">Inactivo en la cuenta principal</Badge>
        ) : (
          <Badge tone="success">Disponible</Badge>
        ),
    },
    {
      key: "acciones",
      header: "",
      align: "right",
      render: (p) => (
        <Button variant="ghost" size="sm" onClick={() => onVerProducto(p.code ?? p.nombre)}>
          Ver en Productos
        </Button>
      ),
    },
  ]

  return (
    <section className="flex flex-col gap-4" aria-label={`Revisión de ${cuenta.nombre}`}>
      <div>
        <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>{cuenta.nombre}</h2>
        <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
          {cuenta.ultimaSync
            ? `Última sincronización: ${ESTADO_SYNC[cuenta.ultimaSync.estado] ?? cuenta.ultimaSync.estado}, ${fmtFechaHora(cuenta.ultimaSync.finalizadaEn)}`
            : "Todavía no se sincronizó esta cuenta."}
          {!cuenta.activa ? " · La cuenta está desactivada." : ""}
        </p>
        {cuenta.ultimaSync?.estado === "parcial" && (
          <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
            La última sincronización quedó incompleta: no se dio de baja ningún producto.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>Códigos a revisar</h3>
        <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
          Estos productos no se ofrecen en la tienda ni suman stock hasta que se corrijan en Alegra: un código repetido o
          ausente impide emparejarlos con los de la otra cuenta.
        </p>
        {!r ? (
          <p className="text-sm" style={{ color: "var(--ink-faint)" }}>Sin datos: falta una sincronización de esta cuenta.</p>
        ) : r.duplicados.total === 0 && r.sinCodigo.total === 0 ? (
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>No hay códigos para revisar.</p>
        ) : (
          <>
            {r.duplicados.total > 0 && (
              <>
                <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                  Código duplicado ({r.duplicados.total})
                </p>
                <Table<DuplicadoRevisar> columns={columnasDuplicados} rows={r.duplicados.items} rowKey={(d) => d.codigo} empty="Sin duplicados" />
                {r.duplicados.total > r.duplicados.items.length && (
                  <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
                    Se muestran los primeros {r.duplicados.items.length} de {r.duplicados.total}.
                  </p>
                )}
              </>
            )}
            {r.sinCodigo.total > 0 && (
              <>
                <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                  Sin código ({r.sinCodigo.total})
                </p>
                <Table<ItemRevisar> columns={columnasSinCodigo} rows={r.sinCodigo.items} rowKey={(i) => i.alegraId} empty="Sin productos" />
                {r.sinCodigo.total > r.sinCodigo.items.length && (
                  <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
                    Se muestran los primeros {r.sinCodigo.items.length} de {r.sinCodigo.total}.
                  </p>
                )}
              </>
            )}
          </>
        )}
        {r && r.listasSinEquivalente.length > 0 && (
          <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
            Listas de precio de esta cuenta sin una del mismo nombre en la cuenta principal (sus precios se descartan):{" "}
            {r.listasSinEquivalente.join(", ")}.
            {r.sinPrecio > 0 ? ` ${r.sinPrecio} producto${r.sinPrecio === 1 ? "" : "s"} quedó sin precio y no se puede vender.` : ""}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>Productos solo en {etiqueta}</h3>
        <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
          Existen únicamente en esta cuenta: no es un error. Se publican y se editan desde Productos como cualquier otro.
        </p>
        {cuenta.soloEnCuenta.total === 0 ? (
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>No hay productos que existan solo en esta cuenta.</p>
        ) : (
          <>
            <Table<ProductoSoloEnCuenta> columns={columnasSolo} rows={cuenta.soloEnCuenta.items} rowKey={(p) => p.alegraId} empty="Sin productos" />
            {cuenta.soloEnCuenta.total > cuenta.soloEnCuenta.items.length && (
              <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
                Se muestran los primeros {cuenta.soloEnCuenta.items.length} de {cuenta.soloEnCuenta.total}. Use el filtro «Cuenta de origen» en Productos para verlos todos.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
