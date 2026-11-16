"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Alert, Badge, Button, Card, Dialog, Field, Input, SearchInput, Select, Textarea } from "@myd-org/ui"
import { ivaBpDePorcentaje, totalDeLineasCentavos } from "@/lib/compras-dinero"
import { IVA_SOPORTADOS, validarEntradaCompra } from "@/lib/compras-entrada"
import { AVISO_COSTO_PROMEDIO, formatoPesos } from "@/lib/compras-formato"
import { ConfigCuentaDialog } from "./ConfigCuentaDialog"
import { LectorFacturaPdf, type LecturaFactura } from "./LectorFacturaPdf"
import { ProductoAltaDialog, type ModoAlta } from "./ProductoAltaDialog"

// «Nueva compra» (y edición de ítems/percepciones de una compra pendiente). Toda escritura en Alegra
// pasa por una confirmación previa; la clave de idempotencia se genera al abrir el formulario, así
// que un doble clic o un reintento no duplican la factura. Los costos son NETOS (sin IVA).

export interface ItemForm {
  alegraId: string
  nombre: string
  codigo: string | null
  cantidad: string
  costo: string
  iva: string
}

export interface PercepcionForm {
  nombre: string
  importe: string
  certificado: string
}

interface ProveedorSel {
  id: string
  nombre: string
  cuit: string | null
}

interface ProductoResultado {
  alegraId: string
  codigo: string | null
  nombre: string
  marca: string | null
  ivaPorcentaje: number | null
  costoReferencia: number | null
  itemIdCuenta: string | null
  sinItemEnCuenta: boolean
}

export interface CompraInicial {
  compraId: string
  cuentaSlug: string
  proveedor: ProveedorSel
  numeroFactura: string
  fecha: string
  vencimiento: string
  observaciones: string
  items: ItemForm[]
  percepciones: PercepcionForm[]
}

interface Props {
  cuentas: { slug: string; nombre: string }[]
  /** Nombres de percepción configurados por cuenta (slug -> nombres). */
  percepcionesPorCuenta: Record<string, string[]>
  esAdmin: boolean
  inicial?: CompraInicial
}

const hoy = () => new Date().toISOString().slice(0, 10)
const opcionesIva = IVA_SOPORTADOS.map((v) => ({ label: `${String(v).replace(".", ",")} %`, value: String(v) }))
const ivaInicial = (v: number | null) => (v !== null && (IVA_SOPORTADOS as readonly number[]).includes(v) ? String(v) : "21")

function useDebounced<T>(valor: T, ms = 250): T {
  const [v, setV] = useState(valor)
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])
  return v
}

export function NuevaCompraForm({ cuentas, percepcionesPorCuenta, esAdmin, inicial }: Props) {
  const router = useRouter()
  const edicion = Boolean(inicial)
  const [claveOperacion] = useState(() => crypto.randomUUID())

  const [cuenta, setCuenta] = useState(inicial?.cuentaSlug ?? cuentas[0]?.slug ?? "")
  const [proveedor, setProveedor] = useState<ProveedorSel | null>(inicial?.proveedor ?? null)
  const [numero, setNumero] = useState(inicial?.numeroFactura ?? "")
  const [fecha, setFecha] = useState(inicial?.fecha ?? hoy())
  const [vencimiento, setVencimiento] = useState(inicial?.vencimiento ?? hoy())
  const [observaciones, setObservaciones] = useState(inicial?.observaciones ?? "")
  const [items, setItems] = useState<ItemForm[]>(inicial?.items ?? [])
  const [percepciones, setPercepciones] = useState<PercepcionForm[]>(inicial?.percepciones ?? [])

  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<{ mensaje: string; codigo?: string } | null>(null)
  const [aviso, setAviso] = useState<{ mensaje: string; compraId: string } | null>(null)
  const [configAbierta, setConfigAbierta] = useState(false)
  const [lectura, setLectura] = useState<LecturaFactura | null>(null)
  const enviandoRef = useRef(false)

  const nombreCuenta = cuentas.find((c) => c.slug === cuenta)?.nombre ?? cuenta
  const nombresPercepcion = percepcionesPorCuenta[cuenta] ?? []

  // Cambiar de cuenta invalida proveedor y productos (los ítems de Alegra son de cada cuenta).
  function cambiarCuenta(slug: string) {
    if (slug === cuenta) return
    setCuenta(slug)
    setProveedor(null)
    setItems([])
    setPercepciones([])
    setError(null)
  }

  // Lectura del PDF: completa el formulario (reemplaza lo cargado); el usuario revisa antes de registrar.
  function aplicarLectura(l: LecturaFactura) {
    setLectura(l)
    setError(null)
    if (l.proveedor) setProveedor(l.proveedor)
    setNumero(l.numeroFactura ?? "")
    if (l.fecha) setFecha(l.fecha)
    setVencimiento(l.vencimiento ?? l.fecha ?? vencimiento)
    setItems(
      l.items.map((i) => ({
        alegraId: i.alegraId,
        nombre: i.nombre,
        codigo: i.codigo,
        cantidad: String(i.cantidad),
        costo: i.costo.toFixed(2),
        iva: ivaInicial(i.ivaPct),
      })),
    )
  }

  // ── Armado y validación (la misma función pura que usa el servidor) ──
  const cuerpo = useMemo(
    () => ({
      cuenta,
      idempotencyKey: claveOperacion,
      proveedor: proveedor ? { id: proveedor.id, nombre: proveedor.nombre, cuit: proveedor.cuit } : { id: "", nombre: "" },
      numeroFactura: numero,
      fecha,
      vencimiento,
      observaciones,
      items: items.map((i) => ({ alegraId: i.alegraId, cantidad: i.cantidad, costo: i.costo, ivaPorcentaje: Number(i.iva) })),
      percepciones: percepciones.map((p) => ({ nombre: p.nombre, importe: p.importe, certificado: p.certificado })),
    }),
    [cuenta, claveOperacion, proveedor, numero, fecha, vencimiento, observaciones, items, percepciones],
  )
  const validacion = useMemo(() => validarEntradaCompra(cuerpo), [cuerpo])

  const totales = useMemo(() => {
    if (!validacion.ok) return null
    const v = validacion.value
    const bp: Record<string, number> = {}
    const lineas = v.items.map((i) => {
      const b = ivaBpDePorcentaje(i.ivaPorcentaje)
      bp[String(b)] = b
      return { precioCentavos: i.costoCentavos, cantidadMilesimas: i.cantidadMilesimas, taxIds: [String(b)] }
    })
    const sinIva = totalDeLineasCentavos(lineas.map((l) => ({ ...l, taxIds: [] })), {})
    const factura = totalDeLineasCentavos(lineas, bp)
    const perc = v.percepciones.reduce((a, p) => a + p.importeCentavos, 0)
    return { neto: sinIva, iva: factura - sinIva, percepciones: perc, total: factura + perc }
  }, [validacion])

  async function enviar() {
    if (enviandoRef.current) return
    enviandoRef.current = true
    setEnviando(true)
    setError(null)
    try {
      const url = edicion ? `/api/admin/compras/${inicial!.compraId}` : "/api/admin/compras"
      const res = await fetch(url, {
        method: edicion ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(edicion ? { items: cuerpo.items, percepciones: cuerpo.percepciones } : cuerpo),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setConfirmando(false)
        setError({ mensaje: json?.error ?? "No se pudo registrar la compra. Inténtelo nuevamente.", codigo: json?.code })
        return
      }
      if (res.status === 202 && json?.aviso) {
        setConfirmando(false)
        setAviso({ mensaje: json.aviso, compraId: json.compraId })
        return
      }
      router.push(`/admin/compras/${edicion ? inicial!.compraId : json.compraId}`)
      router.refresh()
    } catch {
      setConfirmando(false)
      setError({ mensaje: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  if (aviso) {
    return (
      <Alert tone="warning" title="Compra pendiente de verificación">
        <p>{aviso.mensaje}</p>
        <div className="mt-3">
          <Button href={`/admin/compras/${aviso.compraId}`}>Ver la compra</Button>
        </div>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="neutral">{AVISO_COSTO_PROMEDIO}</Alert>

      {error && (
        <Alert tone="danger">
          <p>{error.mensaje}</p>
          {esAdmin && ["sin_transito", "percepcion_sin_configurar"].includes(error.codigo ?? "") && (
            <div className="mt-3">
              <Button variant="secondary" onClick={() => setConfigAbierta(true)}>
                Configurar la cuenta
              </Button>
            </div>
          )}
          {!esAdmin && ["sin_transito", "percepcion_sin_configurar"].includes(error.codigo ?? "") && (
            <p className="mt-2">Pida a un administrador que complete la configuración de Compras de esta cuenta.</p>
          )}
        </Alert>
      )}

      {!edicion && <LectorFacturaPdf cuenta={cuenta} lectura={lectura} netoFormulario={totales?.neto ?? null} onLeida={aplicarLectura} />}

      <Card title="Factura del proveedor">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Cuenta de Alegra" hint="La factura se registra en esta cuenta.">
            <Select
              value={cuenta}
              onValueChange={cambiarCuenta}
              disabled={edicion}
              options={cuentas.map((c) => ({ label: c.nombre, value: c.slug }))}
              aria-label="Cuenta de Alegra"
            />
          </Field>
          <ProveedorBuscador cuenta={cuenta} proveedor={proveedor} onChange={setProveedor} deshabilitado={edicion} />
          <Field label="Número de factura">
            <Input value={numero} onChange={(e) => setNumero(e.target.value)} disabled={edicion} placeholder="0001-00000123" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Fecha">
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={edicion} />
            </Field>
            <Field label="Vencimiento">
              <Input type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} disabled={edicion} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Observaciones (opcional)">
              <Textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} disabled={edicion} rows={2} />
            </Field>
          </div>
        </div>
        {edicion && (
          <p className="mt-3 text-sm" style={{ color: "var(--ink-soft)" }}>
            El proveedor, el número y las fechas no se pueden modificar. Para cambiarlos, anule la compra y vuelva a cargarla.
          </p>
        )}
      </Card>

      <Card title="Productos" description="Cantidad y costo unitario NETO (sin IVA) según la factura.">
        <ProductoBuscador
          cuenta={cuenta}
          nombreCuenta={nombreCuenta}
          proveedorId={proveedor?.id ?? ""}
          yaAgregados={new Set(items.map((i) => i.alegraId))}
          onAgregar={(p) =>
            setItems((l) => [
              ...l,
              {
                alegraId: p.alegraId,
                nombre: p.nombre,
                codigo: p.codigo,
                cantidad: "1",
                costo: p.costoReferencia !== null ? p.costoReferencia.toFixed(2) : "",
                iva: ivaInicial(p.ivaPorcentaje),
              },
            ])
          }
        />
        <div className="mt-4 flex flex-col gap-3">
          {items.length === 0 && (
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              Busque un producto por nombre o código para agregarlo.
            </p>
          )}
          {items.map((it, i) => (
            <div key={it.alegraId} className="grid items-end gap-2 md:grid-cols-[1fr_7rem_9rem_8rem_auto]">
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>{it.nombre}</p>
                {it.codigo && <p className="text-xs" style={{ color: "var(--ink-soft)" }}>{it.codigo}</p>}
              </div>
              <Field label="Cantidad">
                <Input
                  inputMode="decimal"
                  value={it.cantidad}
                  onChange={(e) => setItems((l) => l.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))}
                />
              </Field>
              <Field label="Costo neto">
                <Input
                  inputMode="decimal"
                  value={it.costo}
                  onChange={(e) => setItems((l) => l.map((x, j) => (j === i ? { ...x, costo: e.target.value } : x)))}
                />
              </Field>
              <Field label="IVA">
                <Select
                  value={it.iva}
                  onValueChange={(v) => setItems((l) => l.map((x, j) => (j === i ? { ...x, iva: v } : x)))}
                  options={opcionesIva}
                  aria-label="IVA"
                />
              </Field>
              <Button variant="secondary" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>
                Quitar
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Percepciones" description="Se cargan en Alegra junto con la factura y no modifican el costo de los productos.">
        <div className="flex flex-col gap-3">
          {percepciones.map((p, i) => (
            <div key={i} className="grid items-end gap-2 md:grid-cols-[1fr_9rem_1fr_auto]">
              <Field label="Tipo">
                <Select
                  value={p.nombre}
                  onValueChange={(v) => setPercepciones((l) => l.map((x, j) => (j === i ? { ...x, nombre: v } : x)))}
                  options={nombresPercepcion.map((n) => ({ label: n, value: n }))}
                  placeholder="Seleccione"
                  aria-label="Tipo de percepción"
                />
              </Field>
              <Field label="Importe">
                <Input
                  inputMode="decimal"
                  value={p.importe}
                  onChange={(e) => setPercepciones((l) => l.map((x, j) => (j === i ? { ...x, importe: e.target.value } : x)))}
                />
              </Field>
              <Field label="N.º de certificado (opcional)">
                <Input
                  value={p.certificado}
                  onChange={(e) => setPercepciones((l) => l.map((x, j) => (j === i ? { ...x, certificado: e.target.value } : x)))}
                />
              </Field>
              <Button variant="secondary" onClick={() => setPercepciones((l) => l.filter((_, j) => j !== i))}>
                Quitar
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => setPercepciones((l) => [...l, { nombre: "", importe: "", certificado: "" }])}
              disabled={nombresPercepcion.length === 0}
            >
              Agregar percepción
            </Button>
            {nombresPercepcion.length === 0 && (
              <span className="text-sm" style={{ color: "var(--ink-soft)" }}>
                Esta cuenta no tiene percepciones configuradas.
              </span>
            )}
            {esAdmin && !edicion && (
              <Button variant="link" onClick={() => setConfigAbierta(true)}>
                Configurar la cuenta
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
            <dt style={{ color: "var(--ink-soft)" }}>Neto</dt>
            <dd className="text-right">{totales ? formatoPesos(totales.neto) : "—"}</dd>
            <dt style={{ color: "var(--ink-soft)" }}>IVA</dt>
            <dd className="text-right">{totales ? formatoPesos(totales.iva) : "—"}</dd>
            <dt style={{ color: "var(--ink-soft)" }}>Percepciones</dt>
            <dd className="text-right">{totales ? formatoPesos(totales.percepciones) : "—"}</dd>
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-semibold">{totales ? formatoPesos(totales.total) : "—"}</dd>
          </dl>
          <div className="flex flex-col items-end gap-2">
            {!validacion.ok && (items.length > 0 || numero || proveedor) && (
              <p className="max-w-sm text-right text-sm" style={{ color: "var(--ink-soft)" }}>{validacion.error}</p>
            )}
            <Button onClick={() => setConfirmando(true)} disabled={!validacion.ok || enviando}>
              {edicion ? "Guardar cambios" : "Registrar compra"}
            </Button>
          </div>
        </div>
      </Card>

      <Dialog
        open={confirmando}
        onOpenChange={(o) => !enviando && setConfirmando(o)}
        title={edicion ? "Guardar cambios" : "Registrar compra"}
        description={
          edicion
            ? "Se actualizará la factura en Alegra con los productos y las percepciones indicados."
            : "Se creará la factura de compra en Alegra con la mercadería «en tránsito»."
        }
        dismissible={!enviando}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmando(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={enviar} loading={enviando}>
              {edicion ? "Guardar cambios" : "Registrar compra"}
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt style={{ color: "var(--ink-soft)" }}>Cuenta</dt>
          <dd>{nombreCuenta}</dd>
          <dt style={{ color: "var(--ink-soft)" }}>Proveedor</dt>
          <dd>{proveedor?.nombre}</dd>
          <dt style={{ color: "var(--ink-soft)" }}>Factura</dt>
          <dd>{numero}</dd>
          <dt style={{ color: "var(--ink-soft)" }}>Productos</dt>
          <dd>{items.length}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="font-semibold">{totales ? formatoPesos(totales.total) : "—"}</dd>
        </dl>
      </Dialog>

      {esAdmin && (
        <ConfigCuentaDialog key={cuenta} cuenta={cuenta} nombreCuenta={nombreCuenta} open={configAbierta} onOpenChange={setConfigAbierta} onGuardado={() => router.refresh()} />
      )}
    </div>
  )
}

// ── Proveedor ─────────────────────────────────────────────────────────────────────────────────────

function ProveedorBuscador({
  cuenta,
  proveedor,
  onChange,
  deshabilitado,
}: {
  cuenta: string
  proveedor: ProveedorSel | null
  onChange: (p: ProveedorSel | null) => void
  deshabilitado: boolean
}) {
  const [q, setQ] = useState("")
  const dq = useDebounced(q)
  const [encontrados, setResultados] = useState<ProveedorSel[]>([])
  const [aviso, setAviso] = useState<string | null>(null)
  const [listoPara, setListoPara] = useState("")
  const busca = !deshabilitado && !proveedor && dq.trim().length >= 2 && Boolean(cuenta)
  const cargando = busca && listoPara !== dq
  const resultados = busca ? encontrados : []

  useEffect(() => {
    if (!busca) return
    const ac = new AbortController()
    fetch(`/api/admin/compras/proveedores?cuenta=${encodeURIComponent(cuenta)}&q=${encodeURIComponent(dq)}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        setResultados(j.proveedores ?? [])
        setAviso(j.aviso ?? null)
      })
      .catch(() => undefined)
      .finally(() => setListoPara(dq))
    return () => ac.abort()
  }, [dq, cuenta, busca])

  if (proveedor) {
    return (
      <Field label="Proveedor">
        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2" style={{ borderColor: "var(--line)" }}>
          <span className="text-sm">{proveedor.nombre}</span>
          {!deshabilitado && (
            <Button variant="link" onClick={() => onChange(null)}>
              Cambiar
            </Button>
          )}
        </div>
      </Field>
    )
  }
  return (
    <div>
      <Field label="Proveedor">
        <SearchInput value={q} onValueChange={setQ} placeholder="Buscar por nombre o CUIT" aria-label="Buscar proveedor" />
      </Field>
      {aviso && <p className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>{aviso}</p>}
      {cargando && <p className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>Buscando…</p>}
      {resultados.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-auto rounded-md border" style={{ borderColor: "var(--line)" }}>
          {resultados.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-black/5"
                onClick={() => {
                  onChange(p)
                  setQ("")
                  setResultados([])
                }}
              >
                {p.nombre}
                {p.cuit && <span className="ml-2 text-xs" style={{ color: "var(--ink-soft)" }}>{p.cuit}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!cargando && dq.trim().length >= 2 && resultados.length === 0 && (
        <p className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>No se encontraron proveedores.</p>
      )}
    </div>
  )
}

// ── Productos ─────────────────────────────────────────────────────────────────────────────────────

function ProductoBuscador({
  cuenta,
  nombreCuenta,
  proveedorId,
  yaAgregados,
  onAgregar,
}: {
  cuenta: string
  nombreCuenta: string
  proveedorId: string
  yaAgregados: Set<string>
  onAgregar: (p: ProductoResultado) => void
}) {
  const [q, setQ] = useState("")
  const dq = useDebounced(q)
  const [encontrados, setResultados] = useState<ProductoResultado[]>([])
  const [listoPara, setListoPara] = useState("")
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [buscandoId, setBuscandoId] = useState<string | null>(null)
  const [alta, setAlta] = useState<ModoAlta | null>(null)
  const busca = dq.trim().length >= 2 && Boolean(cuenta)
  const cargando = busca && listoPara !== dq
  const resultados = busca ? encontrados : []

  useEffect(() => {
    if (!busca) return
    const ac = new AbortController()
    fetch(`/api/admin/compras/productos?cuenta=${encodeURIComponent(cuenta)}&q=${encodeURIComponent(dq)}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => setResultados(j.productos ?? []))
      .catch(() => undefined)
      .finally(() => setListoPara(dq))
    return () => ac.abort()
  }, [dq, cuenta, busca])

  async function buscarEnAlegra(p: ProductoResultado) {
    setBuscandoId(p.alegraId)
    setMensaje(null)
    try {
      const res = await fetch("/api/admin/compras/productos/parear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cuenta, alegraId: p.alegraId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setMensaje(json?.error ?? "No se pudo buscar el producto en Alegra.")
        return
      }
      setResultados((l) => l.map((x) => (x.alegraId === p.alegraId ? { ...x, itemIdCuenta: json.itemIdCuenta, sinItemEnCuenta: false } : x)))
    } catch {
      setMensaje("Error de conexión. Inténtelo nuevamente.")
    } finally {
      setBuscandoId(null)
    }
  }

  return (
    <div>
      <SearchInput value={q} onValueChange={setQ} placeholder="Buscar producto por nombre o código" aria-label="Buscar producto" />
      {mensaje && <Alert tone="warning">{mensaje}</Alert>}
      {cargando && <p className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>Buscando…</p>}
      {resultados.length > 0 && (
        <ul className="mt-2 max-h-72 overflow-auto rounded-md border" style={{ borderColor: "var(--line)" }}>
          {resultados.map((p) => (
            <li key={p.alegraId} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm">{p.nombre}</p>
                <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
                  {[p.codigo, p.marca].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {p.sinItemEnCuenta && <Badge tone="warning">Sin ítem en la cuenta</Badge>}
                {p.sinItemEnCuenta ? (
                  <>
                    <Button variant="secondary" loading={buscandoId === p.alegraId} onClick={() => buscarEnAlegra(p)}>
                      Buscar en Alegra
                    </Button>
                    <Button variant="secondary" onClick={() => setAlta({ tipo: "copiar", producto: p })}>
                      Copiar a {nombreCuenta}
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" disabled={yaAgregados.has(p.alegraId)} onClick={() => onAgregar(p)}>
                    {yaAgregados.has(p.alegraId) ? "Agregado" : "Agregar"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!cargando && dq.trim().length >= 2 && resultados.length === 0 && (
        <p className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>No se encontraron productos.</p>
      )}
      {Boolean(cuenta) && (
        <div className="mt-2">
          <Button variant="secondary" onClick={() => setAlta({ tipo: "crear", nombreInicial: q.trim() })}>
            Crear producto
          </Button>
        </div>
      )}
      {alta && (
        <ProductoAltaDialog
          key={alta.tipo === "copiar" ? `copiar-${alta.producto.alegraId}` : "crear"}
          modo={alta}
          cuenta={cuenta}
          nombreCuenta={nombreCuenta}
          proveedorId={proveedorId}
          open
          onOpenChange={(abierto) => !abierto && setAlta(null)}
          onListo={(p, itemIdCuenta) => {
            const nuevo: ProductoResultado = { ...p, itemIdCuenta, sinItemEnCuenta: false }
            setResultados((l) => (l.some((x) => x.alegraId === nuevo.alegraId) ? l.map((x) => (x.alegraId === nuevo.alegraId ? nuevo : x)) : [nuevo, ...l]))
            onAgregar(nuevo)
          }}
        />
      )}
    </div>
  )
}
