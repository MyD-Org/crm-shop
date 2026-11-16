"use client"

import { useEffect, useState } from "react"
import { Alert, Button, Dialog, Field, Input, Select, Spinner, useToast } from "@myd-org/ui"

// Configuración de Compras por cuenta de Alegra (sólo admin o superior): cuenta contable de tránsito,
// depósito y los códigos de las percepciones (el catálogo de percepciones de Alegra no se puede listar
// por API: el código se obtiene una vez agregando la percepción a una factura en Alegra).

interface RespuestaConfig {
  config: { categoriaTransitoId: string | null; percepciones: Record<string, string>; almacenId: string | null }
  transito: { estado: string; id?: string; mensaje?: string }
  categorias: { id: string; nombre: string }[]
  almacenes: { id: string; nombre: string; porDefecto: boolean }[]
}

const AUTO = "__auto__"

export function ConfigCuentaDialog({
  cuenta,
  nombreCuenta,
  open,
  onOpenChange,
  onGuardado,
}: {
  cuenta: string
  nombreCuenta: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onGuardado?: () => void
}) {
  const { toast } = useToast()
  const [datos, setDatos] = useState<RespuestaConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [categoria, setCategoria] = useState(AUTO)
  const [almacen, setAlmacen] = useState(AUTO)
  const [percepciones, setPercepciones] = useState<{ nombre: string; codigo: string }[]>([])

  useEffect(() => {
    if (!open || !cuenta) return
    let vivo = true
    fetch(`/api/admin/compras/config?cuenta=${encodeURIComponent(cuenta)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null)
        if (!vivo) return
        if (!res.ok) {
          setError(json?.error ?? "No se pudo cargar la configuración. Inténtelo nuevamente.")
          return
        }
        const d = json as RespuestaConfig
        setDatos(d)
        setCategoria(d.config.categoriaTransitoId ?? AUTO)
        setAlmacen(d.config.almacenId ?? AUTO)
        setPercepciones(Object.entries(d.config.percepciones).map(([nombre, codigo]) => ({ nombre, codigo })))
      })
      .catch(() => vivo && setError("Error de conexión. Inténtelo nuevamente."))
    return () => {
      vivo = false
    }
  }, [open, cuenta])

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      const mapa: Record<string, string> = {}
      for (const p of percepciones) if (p.nombre.trim() || p.codigo.trim()) mapa[p.nombre.trim()] = p.codigo.trim()
      const res = await fetch(`/api/admin/compras/config?cuenta=${encodeURIComponent(cuenta)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoriaTransitoId: categoria === AUTO ? null : categoria,
          almacenId: almacen === AUTO ? null : almacen,
          percepciones: mapa,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? "No se pudo guardar. Inténtelo nuevamente.")
        return
      }
      toast({ title: "Configuración guardada", tone: "success" })
      onGuardado?.()
      onOpenChange(false)
    } catch {
      setError("Error de conexión. Inténtelo nuevamente.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Configurar Compras: ${nombreCuenta}`}
      description="Estos datos se usan al registrar facturas de proveedor en esta cuenta de Alegra."
      dismissible={false}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} loading={guardando} disabled={!datos}>
            Guardar
          </Button>
        </>
      }
    >
      {!datos && !error && <Spinner label="Cargando" />}
      {error && <Alert tone="danger">{error}</Alert>}
      {datos && (
        <div className="flex flex-col gap-4">
          {datos.transito.estado !== "ok" && datos.transito.mensaje && <Alert tone="warning">{datos.transito.mensaje}</Alert>}
          <Field label="Cuenta contable de tránsito" hint="Por defecto se busca «Mercadería en tránsito» por nombre.">
            <Select
              value={categoria}
              onValueChange={setCategoria}
              options={[
                { label: "Detectar por nombre", value: AUTO },
                ...datos.categorias.map((c) => ({ label: c.nombre, value: c.id })),
              ]}
            />
          </Field>
          <Field label="Depósito">
            <Select
              value={almacen}
              onValueChange={setAlmacen}
              options={[
                { label: "Predeterminado de Alegra", value: AUTO },
                ...datos.almacenes.map((a) => ({ label: a.nombre, value: a.id })),
              ]}
            />
          </Field>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>Percepciones</p>
            <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
              Indique el nombre que verá en la compra y el código de la percepción en Alegra.
            </p>
            {percepciones.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label={i === 0 ? "Nombre" : undefined}>
                  <Input
                    value={p.nombre}
                    onChange={(e) => setPercepciones((l) => l.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))}
                    placeholder="Ingresos brutos Buenos Aires"
                  />
                </Field>
                <Field label={i === 0 ? "Código en Alegra" : undefined}>
                  <Input
                    value={p.codigo}
                    onChange={(e) => setPercepciones((l) => l.map((x, j) => (j === i ? { ...x, codigo: e.target.value } : x)))}
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </Field>
                <Button variant="secondary" onClick={() => setPercepciones((l) => l.filter((_, j) => j !== i))}>
                  Quitar
                </Button>
              </div>
            ))}
            <div>
              <Button variant="secondary" onClick={() => setPercepciones((l) => [...l, { nombre: "", codigo: "" }])}>
                Agregar percepción
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}
