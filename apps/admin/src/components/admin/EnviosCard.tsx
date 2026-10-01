"use client"

import { useEffect, useState } from "react"
import { Button, Card, Checkbox, Field, Input, SegmentedControl, Switch, useToast } from "@myd-org/ui"
import { textoPreview, validarEnvio, type AlcanceEnvio, type ConfigEnvio, type ModoMinimoEnvio } from "@/lib/envios-validacion"
import { PROVINCIAS, claveProvincia } from "@/lib/provincias"

// Envíos: dos interruptores independientes. "Envío a domicilio" (se ofrece, con costo a coordinar)
// y "Envío gratis"; sólo con gratis en Sí se muestran y exigen el alcance y el monto mínimo.
// Rige para los pedidos NUEVOS. Cada guardado avisa al Shop (best-effort): si el aviso no llegó,
// el cambio igual quedó guardado y la tienda lo toma en su próximo ciclo.

type Errores = Record<string, string>

type Form = {
  domicilioActivo: boolean
  gratisActivo: boolean
  alcance: AlcanceEnvio | ""
  provincias: string[]
  minimoModo: ModoMinimoEnvio | ""
  minimo: string
}

const OPCIONES_ALCANCE = [
  { value: "pais", label: "Todo el país" },
  { value: "provincias", label: "Solo estas provincias" },
]

const OPCIONES_MINIMO = [
  { value: "sin_minimo", label: "Sin mínimo" },
  { value: "desde", label: "Desde $" },
]

const desdeConfig = (c: ConfigEnvio): Form => ({
  domicilioActivo: c.domicilioActivo,
  gratisActivo: c.gratisActivo,
  alcance: c.alcance ?? "",
  provincias: c.provincias,
  minimoModo: c.minimoModo ?? "",
  minimo: c.minimo === null ? "" : String(c.minimo),
})

const cuerpo = (f: Form) => ({
  domicilioActivo: f.domicilioActivo,
  gratisActivo: f.gratisActivo,
  alcance: f.alcance || null,
  provincias: f.provincias,
  minimoModo: f.minimoModo || null,
  minimo: f.minimo,
})

const TITULO_SECCION = "text-xs font-semibold uppercase tracking-wider"

export function EnviosCard() {
  const [form, setForm] = useState<Form | null>(null)
  const [errores, setErrores] = useState<Errores>({})
  const [guardando, setGuardando] = useState(false)
  const [errorCarga, setErrorCarga] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    let vivo = true
    fetch("/api/admin/envios", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { envio?: ConfigEnvio } | null
        if (!vivo) return
        if (!res.ok || !json?.envio) setErrorCarga(true)
        else setForm(desdeConfig(json.envio))
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

  const alternarProvincia = (clave: string, marcada: boolean) => {
    if (!form) return
    const set = new Set(form.provincias)
    if (marcada) set.add(clave)
    else set.delete(clave)
    cambiar("provincias", [...set])
  }

  async function guardar() {
    if (!form) return
    const v = validarEnvio(cuerpo(form))
    if (!v.ok) {
      setErrores({ [v.campo]: v.error })
      return
    }
    setGuardando(true)
    try {
      const res = await fetch("/api/admin/envios", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cuerpo(form)),
      })
      const json = (await res.json().catch(() => null)) as
        | { error?: string; campo?: string; propagado?: boolean; envio?: ConfigEnvio }
        | null
      if (!res.ok || !json?.envio) {
        setErrores({ [json?.campo && json.campo !== "body" ? json.campo : "general"]: json?.error ?? "No pudimos guardar. Inténtelo nuevamente." })
        return
      }
      setForm(desdeConfig(json.envio))
      setErrores({})
      if (json.propagado === true) toast({ title: "Envíos guardados", tone: "success" })
      else toast({ title: "Envíos guardados", description: "El Shop se actualizará en el próximo ciclo.", tone: "warning" })
    } catch {
      setErrores({ general: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      setGuardando(false)
    }
  }

  // Lo que vería el cliente con lo que hay en el formulario (aunque todavía no esté guardado).
  const vista = form ? validarEnvio(cuerpo(form)) : null
  const preview = vista?.ok
    ? textoPreview(vista.envio)
    : form && !form.gratisActivo
      ? textoPreview({ domicilioActivo: form.domicilioActivo, gratisActivo: false, alcance: null, provincias: [], minimoModo: null, minimo: null })
      : "Complete los datos del envío gratis para ver cómo lo verá el cliente."

  return (
    <Card
      title="Envíos"
      description="Defina si la tienda ofrece envío a domicilio y cuándo es gratis. Rige para los pedidos nuevos; los pedidos ya creados conservan la regla con la que se tomaron."
    >
      {errorCarga && (
        <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
          No pudimos cargar la configuración de envíos. Recargue la página.
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
            <h3 className={TITULO_SECCION} style={{ color: "var(--ink-faint)" }}>
              Envío a domicilio
            </h3>
            <Switch
              id="envio-domicilio"
              checked={form.domicilioActivo}
              onCheckedChange={(v) => cambiar("domicilioActivo", v)}
              label={form.domicilioActivo ? "Sí, la tienda ofrece envío a domicilio" : "No, solo retiro en el local"}
            />
            <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
              Con envío a domicilio activo, el cliente puede pedirlo y el costo se coordina con usted. Si lo desactiva, la tienda solo ofrece el retiro en el local.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className={TITULO_SECCION} style={{ color: "var(--ink-faint)" }}>
              Envío gratis
            </h3>
            <Switch
              id="envio-gratis"
              checked={form.gratisActivo}
              onCheckedChange={(v) => cambiar("gratisActivo", v)}
              label={form.gratisActivo ? "Sí, hay envío gratis" : "No, el envío es con costo a coordinar"}
            />

            {form.gratisActivo && (
              <>
                <Field label="Alcance" hint="Dónde se ofrece el envío gratis." error={errores.alcance}>
                  <SegmentedControl
                    ariaLabel="Alcance del envío gratis"
                    options={OPCIONES_ALCANCE}
                    value={form.alcance}
                    onValueChange={(v) => cambiar("alcance", v as AlcanceEnvio)}
                  />
                </Field>

                {form.alcance === "provincias" && (
                  <Field
                    label="Provincias con envío gratis"
                    hint="En las demás provincias el envío es con costo a coordinar."
                    error={errores.provincias}
                  >
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Provincias con envío gratis">
                      {PROVINCIAS.map((p) => {
                        const clave = claveProvincia(p)
                        const id = `envio-prov-${clave}`
                        return (
                          <label key={clave} htmlFor={id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--ink)" }}>
                            <Checkbox id={id} checked={form.provincias.includes(clave)} onCheckedChange={(v) => alternarProvincia(clave, v)} />
                            {p}
                          </label>
                        )
                      })}
                    </div>
                  </Field>
                )}

                <Field label="Monto mínimo de compra" hint="Sin impuestos. Con “Sin mínimo” el envío es gratis en cualquier compra." error={errores.minimoModo}>
                  <SegmentedControl
                    ariaLabel="Monto mínimo para el envío gratis"
                    options={OPCIONES_MINIMO}
                    value={form.minimoModo}
                    onValueChange={(v) => cambiar("minimoModo", v as ModoMinimoEnvio)}
                  />
                </Field>

                {form.minimoModo === "desde" && (
                  <Field label="Desde (monto sin impuestos)" error={errores.minimo}>
                    <Input
                      inputMode="decimal"
                      placeholder="100000"
                      value={form.minimo}
                      onChange={(e) => cambiar("minimo", e.target.value)}
                      aria-invalid={Boolean(errores.minimo)}
                    />
                  </Field>
                )}

                {form.alcance === "provincias" && form.provincias.length === 0 && (
                  <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                    Todavía no seleccionó ninguna provincia: mientras tanto el envío no será gratis en ningún lugar.
                  </p>
                )}
              </>
            )}
          </section>

          <section className="flex flex-col gap-1">
            <h3 className={TITULO_SECCION} style={{ color: "var(--ink-faint)" }}>
              Cómo lo verá el cliente
            </h3>
            <p className="text-sm" style={{ color: "var(--ink)" }} aria-live="polite">
              {preview}
            </p>
          </section>

          <div>
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar envíos"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
