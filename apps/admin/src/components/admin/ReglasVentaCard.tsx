"use client"

import { useEffect, useState } from "react"
import { Button, Card, Field, Input, Select, Textarea, useToast } from "@myd-org/ui"
import { validarReglasVenta, type ReglasVenta } from "@/lib/reglas-venta-validacion"

// Sucursales: reglas de venta del negocio (disponibilidad, reserva y
// contacto). Rigen para los pedidos NUEVOS; los ya creados conservan la regla con la que se
// tomaron. Cada guardado avisa al Shop (best-effort): si el aviso no llegó, el cambio igual quedó
// guardado y la tienda lo toma en su próximo ciclo.

type Errores = Record<string, string>

type Form = {
  respaldoEnvio: string
  retiroSinStock: string
  trasladoDias: string
  reservaDias: string
  avisoSinContactarHoras: string
  contactoHorasHabiles: string
  mensajeConfirmacion: string
}

const OPCIONES_SI_NO = [
  { value: "si", label: "Sí, despachar desde otra sucursal" },
  { value: "no", label: "No, informar que no hay stock" },
]

const OPCIONES_RETIRO = [
  { value: "ofrecer", label: "Ofrecerlo con demora" },
  { value: "bloquear", label: "No permitir el retiro" },
]

const desdeReglas = (r: ReglasVenta): Form => ({
  respaldoEnvio: r.respaldoEnvio ? "si" : "no",
  retiroSinStock: r.retiroSinStock,
  trasladoDias: String(r.trasladoDias),
  reservaDias: String(r.reservaDias),
  avisoSinContactarHoras: String(r.avisoSinContactarHoras),
  contactoHorasHabiles: String(r.contactoHorasHabiles),
  mensajeConfirmacion: r.mensajeConfirmacion,
})

const cuerpo = (f: Form) => ({
  respaldoEnvio: f.respaldoEnvio === "si",
  retiroSinStock: f.retiroSinStock,
  trasladoDias: f.trasladoDias,
  reservaDias: f.reservaDias,
  avisoSinContactarHoras: f.avisoSinContactarHoras,
  contactoHorasHabiles: f.contactoHorasHabiles,
  mensajeConfirmacion: f.mensajeConfirmacion,
})

export function ReglasVentaCard() {
  const [form, setForm] = useState<Form | null>(null)
  const [errores, setErrores] = useState<Errores>({})
  const [guardando, setGuardando] = useState(false)
  const [errorCarga, setErrorCarga] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    let vivo = true
    fetch("/api/admin/reglas-venta", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { reglas?: ReglasVenta } | null
        if (!vivo) return
        if (!res.ok || !json?.reglas) setErrorCarga(true)
        else setForm(desdeReglas(json.reglas))
      })
      .catch(() => vivo && setErrorCarga(true))
    return () => {
      vivo = false
    }
  }, [])

  const cambiar = (campo: keyof Form, valor: string) => {
    setForm((f) => (f ? { ...f, [campo]: valor } : f))
    setErrores((e) => ({ ...e, [campo]: "", general: "" }))
  }

  async function guardar() {
    if (!form) return
    const v = validarReglasVenta(cuerpo(form))
    if (!v.ok) {
      setErrores({ [v.campo]: v.error })
      return
    }
    setGuardando(true)
    try {
      const res = await fetch("/api/admin/reglas-venta", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cuerpo(form)),
      })
      const json = (await res.json().catch(() => null)) as
        | { error?: string; campo?: string; propagado?: boolean; reglas?: ReglasVenta }
        | null
      if (!res.ok || !json?.reglas) {
        setErrores({ [json?.campo && json.campo !== "body" ? json.campo : "general"]: json?.error ?? "No pudimos guardar. Inténtelo nuevamente." })
        return
      }
      setForm(desdeReglas(json.reglas))
      setErrores({})
      if (json.propagado === true) toast({ title: "Reglas de venta guardadas", tone: "success" })
      else toast({ title: "Reglas de venta guardadas", description: "El Shop se actualizará en el próximo ciclo.", tone: "warning" })
    } catch {
      setErrores({ general: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Card
      title="Reglas de venta"
      description="Definen cómo se ofrece y se reserva el stock por sucursal. Rigen para los pedidos nuevos; los pedidos ya creados conservan la regla con la que se tomaron."
    >
      {errorCarga && (
        <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
          No pudimos cargar las reglas de venta. Recargue la página.
        </p>
      )}
      {!form && !errorCarga && (
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Cargando…
        </p>
      )}
      {form && (
        <div className="flex flex-col gap-5">
          {errores.general && (
            <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
              {errores.general}
            </p>
          )}

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-faint)" }}>
              Disponibilidad
            </h3>
            <Field
              label="Envío con respaldo de otra sucursal"
              hint="Si la sucursal de la zona del cliente no tiene stock, el pedido se despacha desde otra sucursal con stock."
              error={errores.respaldoEnvio}
            >
              <Select options={OPCIONES_SI_NO} value={form.respaldoEnvio} onValueChange={(v) => cambiar("respaldoEnvio", v)} />
            </Field>
            <Field
              label="Retiro sin stock en el local"
              hint="Qué hacer cuando el cliente elige retirar en un local que no tiene el producto pero otra sucursal sí."
              error={errores.retiroSinStock}
            >
              <Select options={OPCIONES_RETIRO} value={form.retiroSinStock} onValueChange={(v) => cambiar("retiroSinStock", v)} />
            </Field>
            <Field
              label="Días de demora al traer de otra sucursal"
              hint="Es la demora que se le informa al cliente. Con 0 se muestra “a coordinar”."
              error={errores.trasladoDias}
            >
              <Input inputMode="numeric" value={form.trasladoDias} onChange={(e) => cambiar("trasladoDias", e.target.value)} />
            </Field>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-faint)" }}>
              Reserva
            </h3>
            <Field
              label="Días de reserva del pedido"
              hint="Los pedidos sin cobro online reservan el stock durante estos días; luego el stock vuelve a estar disponible. Con 0 la reserva no vence."
              error={errores.reservaDias}
            >
              <Input inputMode="numeric" value={form.reservaDias} onChange={(e) => cambiar("reservaDias", e.target.value)} />
            </Field>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-faint)" }}>
              Contacto
            </h3>
            <Field
              label="Horas para el aviso “sin contactar”"
              hint="Pasadas estas horas sin marcar el pedido como contactado, se resalta en Pedidos. Con 0 no se resalta ningún pedido."
              error={errores.avisoSinContactarHoras}
            >
              <Input
                inputMode="numeric"
                value={form.avisoSinContactarHoras}
                onChange={(e) => cambiar("avisoSinContactarHoras", e.target.value)}
              />
            </Field>
            <Field
              label="Horas hábiles prometidas al cliente"
              hint="Plazo, en horario de atención, en el que se le informa al cliente que será contactado."
              error={errores.contactoHorasHabiles}
            >
              <Input
                inputMode="numeric"
                value={form.contactoHorasHabiles}
                onChange={(e) => cambiar("contactoHorasHabiles", e.target.value)}
              />
            </Field>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-faint)" }}>
              Confirmación de la compra
            </h3>
            <Field
              label="Mensaje de confirmación"
              hint="Es el texto que ve el cliente al finalizar la compra. Puede usar {plazo} (el plazo de contacto) y {whatsapp} (el WhatsApp de la sucursal que atiende el pedido): la tienda los reemplaza. Si lo deja vacío, se muestra el mensaje predeterminado."
              error={errores.mensajeConfirmacion}
            >
              <Textarea
                rows={4}
                value={form.mensajeConfirmacion}
                onChange={(e) => cambiar("mensajeConfirmacion", e.target.value)}
                aria-invalid={Boolean(errores.mensajeConfirmacion)}
              />
            </Field>
          </section>

          <div>
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar reglas"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
