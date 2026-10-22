"use client"

import { useEffect, useState } from "react"
import { Button, Card, Field, Input, Switch, useToast } from "@myd-org/ui"
import { MAX_DIAS_DESPACHO, textoPreview, validarDespacho, type ConfigDespacho } from "@/lib/despacho-validacion"

// Plazo de despacho del envío a domicilio que muestra el Shop (ficha, carrito y checkout): si se
// muestra y en cuántos días hábiles sale el pedido. Cada guardado avisa al Shop (best-effort): si
// el aviso no llegó, el cambio igual quedó guardado y la tienda lo toma en su próximo ciclo.

type Errores = Record<string, string>

type Form = { visible: boolean; diasHabiles: string }

const desdeConfig = (c: ConfigDespacho): Form => ({ visible: c.visible, diasHabiles: String(c.diasHabiles) })

const TITULO_SECCION = "text-xs font-semibold uppercase tracking-wider"

export function DespachoCard() {
  const [form, setForm] = useState<Form | null>(null)
  const [errores, setErrores] = useState<Errores>({})
  const [guardando, setGuardando] = useState(false)
  const [errorCarga, setErrorCarga] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    let vivo = true
    fetch("/api/admin/despacho", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { despacho?: ConfigDespacho } | null
        if (!vivo) return
        if (!res.ok || !json?.despacho) setErrorCarga(true)
        else setForm(desdeConfig(json.despacho))
      })
      .catch(() => vivo && setErrorCarga(true))
    return () => {
      vivo = false
    }
  }, [])

  const cambiar = <K extends keyof Form>(campo: K, valor: Form[K]) => {
    setForm((f) => (f ? { ...f, [campo]: valor } : f))
    setErrores((e) => ({ ...e, [campo]: "", general: "" }))
  }

  async function guardar() {
    if (!form) return
    const v = validarDespacho(form)
    if (!v.ok) {
      setErrores({ [v.campo]: v.error })
      return
    }
    setGuardando(true)
    try {
      const res = await fetch("/api/admin/despacho", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      })
      const json = (await res.json().catch(() => null)) as
        | { error?: string; campo?: string; propagado?: boolean; despacho?: ConfigDespacho }
        | null
      if (!res.ok || !json?.despacho) {
        setErrores({ [json?.campo && json.campo !== "body" ? json.campo : "general"]: json?.error ?? "No pudimos guardar. Inténtelo nuevamente." })
        return
      }
      setForm(desdeConfig(json.despacho))
      setErrores({})
      if (json.propagado === true) toast({ title: "Plazo de despacho guardado", tone: "success" })
      else toast({ title: "Plazo de despacho guardado", description: "El Shop se actualizará en el próximo ciclo.", tone: "warning" })
    } catch {
      setErrores({ general: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      setGuardando(false)
    }
  }

  // Lo que vería el cliente con lo que hay en el formulario (aunque todavía no esté guardado).
  const vista = form ? validarDespacho(form) : null
  const preview = vista?.ok ? textoPreview(vista.despacho) : form && !form.visible ? textoPreview({ visible: false, diasHabiles: 1 }) : null

  return (
    <Card
      title="Plazo de despacho"
      description="Es el plazo en el que sale el pedido con envío a domicilio. La tienda lo muestra en la ficha del producto, el carrito y el checkout."
    >
      {errorCarga && (
        <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
          No pudimos cargar el plazo de despacho. Recargue la página.
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
            <Switch
              id="despacho-visible"
              checked={form.visible}
              onCheckedChange={(v) => cambiar("visible", v)}
              label={form.visible ? "Sí, la tienda muestra el plazo de despacho" : "No, la tienda no muestra el plazo de despacho"}
            />
            <Field
              label="Días hábiles para despachar"
              hint={`Desde la compra, de 1 a ${MAX_DIAS_DESPACHO}. Con 1 se muestra “24 h hábiles”. Si hay que traer el producto de otra sucursal, se suman los días de demora de las reglas de venta.`}
              error={errores.diasHabiles}
            >
              <Input
                inputMode="numeric"
                value={form.diasHabiles}
                onChange={(e) => cambiar("diasHabiles", e.target.value)}
                aria-invalid={Boolean(errores.diasHabiles)}
              />
            </Field>
          </section>

          <section className="flex flex-col gap-1">
            <h3 className={TITULO_SECCION} style={{ color: "var(--ink-faint)" }}>
              Cómo lo verá el cliente
            </h3>
            {preview ? (
              <ul className="text-sm flex flex-col gap-1" style={{ color: "var(--ink)" }} aria-live="polite">
                <li>Con stock: {preview.conStock}</li>
                <li>Si hay que traerlo de otra sucursal: {preview.aTraer}</li>
              </ul>
            ) : (
              <p className="text-sm" style={{ color: "var(--ink-soft)" }} aria-live="polite">
                Indique los días hábiles para ver cómo lo verá el cliente.
              </p>
            )}
          </section>

          <div>
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar plazo de despacho"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
