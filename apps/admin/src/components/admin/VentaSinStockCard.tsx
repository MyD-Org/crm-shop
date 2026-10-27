"use client"

import { useEffect, useState } from "react"
import { Badge, Button, Card, Field, Input, Select, Switch, useToast } from "@myd-org/ui"
import {
  avisoPlazoSinFecha,
  MAX_NOMBRE,
  MAX_TEXTO,
  validarModalidad,
  type ModalidadSinStock,
} from "@/lib/modalidades-sin-stock-validacion"
import { bodyDesdeForm, formDesdeModalidad, resumenModalidad, type FormModalidad } from "./venta-sin-stock-ui"

// Modalidades para vender productos sin stock disponible. Cada cambio avisa al Shop (best-effort):
// si el aviso no llegó, el cambio igual quedó guardado y la tienda lo toma en su próximo ciclo.

type Errores = Record<string, string>
type Respuesta = { error?: string; campo?: string; propagado?: boolean; modalidades?: ModalidadSinStock[] }

const API = "/api/admin/modalidades-sin-stock"
const OPCIONES_FLUJO = [
  { value: "en_linea", label: "Pago en línea (como cualquier compra)" },
  { value: "a_confirmar", label: "A confirmar (sin cobro; se coordina por contacto)" },
]
const ERROR_GUARDAR = "No pudimos guardar. Inténtelo nuevamente."

export function VentaSinStockCard() {
  const [modalidades, setModalidades] = useState<ModalidadSinStock[] | null>(null)
  const [errorCarga, setErrorCarga] = useState(false)
  // editando: null = cerrado; "nueva" = alta; id = edición de esa modalidad.
  const [editando, setEditando] = useState<string | null>(null)
  const [form, setForm] = useState<FormModalidad>(formDesdeModalidad())
  const [errores, setErrores] = useState<Errores>({})
  const [guardando, setGuardando] = useState(false)
  // Ids con un PUT/DELETE en vuelo: se deshabilitan los controles de esa fila.
  const [pendientes, setPendientes] = useState<ReadonlySet<string>>(new Set())
  const { toast } = useToast()

  useEffect(() => {
    let vivo = true
    fetch(API, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as Respuesta | null
        if (!vivo) return
        if (!res.ok || !json?.modalidades) setErrorCarga(true)
        else setModalidades(json.modalidades)
      })
      .catch(() => vivo && setErrorCarga(true))
    return () => {
      vivo = false
    }
  }, [])

  const marcar = (id: string, pendiente: boolean) =>
    setPendientes((p) => {
      const n = new Set(p)
      if (pendiente) n.add(id)
      else n.delete(id)
      return n
    })

  const avisarGuardado = (titulo: string, propagado?: boolean) => {
    if (propagado === true) toast({ title: titulo, tone: "success" })
    else toast({ title: titulo, description: "El Shop se actualizará en el próximo ciclo.", tone: "warning" })
  }

  const cambiar = <K extends keyof FormModalidad>(campo: K, valor: FormModalidad[K]) => {
    setForm((f) => ({ ...f, [campo]: valor }))
    setErrores((e) => ({ ...e, [campo]: "", ...(campo === "aCoordinar" ? { plazo: "" } : {}), general: "" }))
  }

  const abrir = (m?: ModalidadSinStock) => {
    setForm(formDesdeModalidad(m))
    setErrores({})
    setEditando(m ? m.id : "nueva")
  }

  const cerrar = () => {
    setEditando(null)
    setErrores({})
  }

  // La API devuelve el error por campo; el campo "plazoDias" del servidor es "plazo" en el formulario.
  const campoDeForm = (campo?: string) => (campo === "plazoDias" ? "plazo" : campo && campo !== "body" ? campo : "general")

  async function guardar() {
    const body = bodyDesdeForm(form)
    const v = validarModalidad(body)
    if (!v.ok) {
      setErrores({ [campoDeForm(v.campo)]: v.error })
      return
    }
    setGuardando(true)
    try {
      const nueva = editando === "nueva"
      const res = await fetch(nueva ? API : `${API}/${editando}`, {
        method: nueva ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => null)) as
        | (Respuesta & { modalidad?: ModalidadSinStock })
        | null
      if (!res.ok || !json?.modalidad) {
        setErrores({ [campoDeForm(json?.campo)]: json?.error ?? ERROR_GUARDAR })
        return
      }
      const guardada = json.modalidad
      setModalidades((lista) =>
        (lista ?? []).some((x) => x.id === guardada.id)
          ? (lista ?? []).map((x) => (x.id === guardada.id ? guardada : x))
          : [...(lista ?? []), guardada],
      )
      cerrar()
      avisarGuardado("Modalidad guardada", json.propagado)
    } catch {
      setErrores({ general: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      setGuardando(false)
    }
  }

  // Interruptor "Activa" de la fila: PUT de la modalidad completa.
  async function alternarActiva(m: ModalidadSinStock, activa: boolean) {
    if (pendientes.has(m.id)) return
    marcar(m.id, true)
    try {
      const res = await fetch(`${API}/${m.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre: m.nombre, texto: m.texto, plazoDias: m.plazoDias, flujo: m.flujo, activa }),
      })
      const json = (await res.json().catch(() => null)) as (Respuesta & { modalidad?: ModalidadSinStock }) | null
      if (!res.ok || !json?.modalidad) {
        toast({ title: json?.error ?? ERROR_GUARDAR, tone: "danger" })
        return
      }
      const guardada = json.modalidad
      setModalidades((lista) => (lista ?? []).map((x) => (x.id === guardada.id ? guardada : x)))
      // Si la fila está abierta en el formulario, que guardar no revierta el interruptor.
      if (editando === guardada.id) setForm((f) => ({ ...f, activa: guardada.activa }))
      avisarGuardado("Modalidad guardada", json.propagado)
    } catch {
      toast({ title: "Error de conexión. Inténtelo nuevamente.", tone: "danger" })
    } finally {
      marcar(m.id, false)
    }
  }

  async function borrar(m: ModalidadSinStock) {
    if (pendientes.has(m.id)) return
    if (!window.confirm(`¿Borrar la modalidad «${m.nombre}»? Los productos asignados quedarán sin modalidad.`)) return
    marcar(m.id, true)
    try {
      const res = await fetch(`${API}/${m.id}`, { method: "DELETE" })
      const json = (await res.json().catch(() => null)) as Respuesta | null
      if (!res.ok) {
        toast({ title: json?.error ?? "No pudimos borrar. Inténtelo nuevamente.", tone: "danger" })
        return
      }
      setModalidades((lista) => (lista ?? []).filter((x) => x.id !== m.id))
      if (editando === m.id) cerrar()
      avisarGuardado("Modalidad borrada", json?.propagado)
    } catch {
      toast({ title: "Error de conexión. Inténtelo nuevamente.", tone: "danger" })
    } finally {
      marcar(m.id, false)
    }
  }

  const aviso = avisoPlazoSinFecha({ plazoDias: form.aCoordinar ? null : 1, flujo: form.flujo })

  return (
    <Card
      title="Venta sin stock"
      description="Modalidades para vender productos sin stock disponible. Sólo se aplican cuando ninguna sucursal puede cubrir el producto."
    >
      {errorCarga && (
        <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
          No pudimos cargar las modalidades. Recargue la página.
        </p>
      )}
      {!modalidades && !errorCarga && (
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Cargando…
        </p>
      )}
      {modalidades && (
        <div className="flex flex-col gap-4">
          {modalidades.length === 0 && editando === null && (
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              Todavía no hay modalidades. Los productos sin stock se muestran «Sin stock» y no se pueden comprar.
            </p>
          )}

          {modalidades.length > 0 && (
            <ul className="flex flex-col gap-2">
              {modalidades.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
                  style={{ borderColor: "var(--line)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                      {m.nombre}
                    </p>
                    <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                      {resumenModalidad(m)}
                    </p>
                  </div>
                  {!m.activa && <Badge>Inactiva</Badge>}
                  <Switch
                    checked={m.activa}
                    disabled={pendientes.has(m.id)}
                    onCheckedChange={(v) => void alternarActiva(m, v)}
                    aria-label={`Activa: ${m.nombre}`}
                  />
                  <Button variant="secondary" size="sm" disabled={pendientes.has(m.id)} onClick={() => abrir(m)}>
                    Editar
                  </Button>
                  <Button variant="secondary" size="sm" disabled={pendientes.has(m.id)} onClick={() => void borrar(m)}>
                    Borrar
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {editando !== null ? (
            <section className="flex flex-col gap-3 rounded-lg border p-3" style={{ borderColor: "var(--line)" }}>
              {errores.general && (
                <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
                  {errores.general}
                </p>
              )}
              <Field label="Nombre interno" error={errores.nombre}>
                <Input
                  value={form.nombre}
                  maxLength={MAX_NOMBRE}
                  onChange={(e) => cambiar("nombre", e.target.value)}
                  aria-invalid={Boolean(errores.nombre)}
                />
              </Field>
              <Field label="Texto para el comprador" error={errores.texto}>
                <Input
                  value={form.texto}
                  maxLength={MAX_TEXTO}
                  onChange={(e) => cambiar("texto", e.target.value)}
                  aria-invalid={Boolean(errores.texto)}
                />
              </Field>
              <Field label="Plazo (días hábiles)" error={errores.plazo}>
                <Input
                  inputMode="numeric"
                  value={form.plazo}
                  disabled={form.aCoordinar}
                  onChange={(e) => cambiar("plazo", e.target.value)}
                  aria-invalid={Boolean(errores.plazo)}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                <input type="checkbox" checked={form.aCoordinar} onChange={(e) => cambiar("aCoordinar", e.target.checked)} />
                A coordinar
              </label>
              <Field label="Flujo de pago" error={errores.flujo}>
                <Select
                  options={OPCIONES_FLUJO}
                  value={form.flujo}
                  onValueChange={(v) => cambiar("flujo", v === "a_confirmar" ? "a_confirmar" : "en_linea")}
                />
              </Field>
              <Switch
                id="modalidad-activa"
                checked={form.activa}
                onCheckedChange={(v) => cambiar("activa", v)}
                label="Activa"
              />
              {aviso && (
                <p className="text-sm" role="status" style={{ color: "var(--ink-soft)" }}>
                  {aviso}
                </p>
              )}
              <div className="flex gap-2">
                <Button onClick={() => void guardar()} disabled={guardando}>
                  {guardando ? "Guardando…" : "Guardar"}
                </Button>
                <Button variant="secondary" onClick={cerrar} disabled={guardando}>
                  Cancelar
                </Button>
              </div>
            </section>
          ) : (
            <div>
              <Button onClick={() => abrir()}>Agregar modalidad</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
