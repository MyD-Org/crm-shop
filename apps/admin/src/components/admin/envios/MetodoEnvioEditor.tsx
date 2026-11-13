"use client"

import { useEffect, useMemo, useState } from "react"
import { Alert, Button, Checkbox, Field, Input, Select, Switch, useToast } from "@myd-org/ui"
import { PROVINCIAS } from "@/lib/provincias"
import { formACuerpo, type FormMetodo } from "@/lib/metodos-envio-form"
import { MAX_FERIADOS, MAX_HORARIO_ENTREGA, esFechaIso } from "@/lib/metodos-envio-horario"
import type { MetodoEnvioDto } from "@/lib/metodos-envio-repo"
import { LocalidadesAtendidasEditor } from "./LocalidadesAtendidasEditor"
import { PruebaDireccionPanel } from "./PruebaDireccionPanel"
import { ZonasEnvioEditor } from "./ZonasEnvioEditor"

// Editor de un método de envío por zona: datos generales, zonas (con mapa), localidades atendidas y
// prueba de dirección. Guarda el método COMPLETO. Los textos que ve el cliente se redactan en usted.

const DIAS = [
  { n: 1, nombre: "Lunes" },
  { n: 2, nombre: "Martes" },
  { n: 3, nombre: "Miércoles" },
  { n: 4, nombre: "Jueves" },
  { n: 5, nombre: "Viernes" },
  { n: 6, nombre: "Sábado" },
]
const SIN_ORIGEN = "__sin_origen__"
const TITULO = "text-xs font-semibold uppercase tracking-wider"

type Sucursal = { slug: string; nombre: string; activa: boolean }
type Errores = Record<string, string>

export function MetodoEnvioEditor({
  inicial,
  onGuardado,
  onEliminado,
  onCancelar,
}: {
  inicial: FormMetodo
  onGuardado: (m: MetodoEnvioDto) => void
  onEliminado: () => void
  onCancelar: () => void
}) {
  const [form, setForm] = useState<FormMetodo>(inicial)
  const [errores, setErrores] = useState<Errores>({})
  const [avisos, setAvisos] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const [nuevoFeriado, setNuevoFeriado] = useState("")
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [seleccionada, setSeleccionada] = useState<string | null>(inicial.zonas[0]?.clave ?? null)
  const [punto, setPunto] = useState<{ lat: number; lon: number } | null>(null)
  const [resaltada, setResaltada] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    let vivo = true
    fetch("/api/admin/sucursales", { cache: "no-store" })
      .then((r) => r.json().catch(() => null))
      .then((j: { sucursales?: Sucursal[] } | null) => vivo && setSucursales((j?.sucursales ?? []).filter((s) => s.activa)))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [])

  const cambiar = <K extends keyof FormMetodo>(campo: K, valor: FormMetodo[K]) => {
    setForm((f) => ({ ...f, [campo]: valor }))
    setErrores((e) => ({ ...e, [campo]: "", general: "" }))
  }

  const agregarFeriado = () => {
    if (!esFechaIso(nuevoFeriado) || form.feriados.includes(nuevoFeriado) || form.feriados.length >= MAX_FERIADOS) return
    cambiar("feriados", [...form.feriados, nuevoFeriado].sort())
    setNuevoFeriado("")
  }
  const quitarFeriado = (f: string) => cambiar("feriados", form.feriados.filter((x) => x !== f))

  const alternarDia = (n: number, marcado: boolean) =>
    cambiar("dias", marcado ? [...new Set([...form.dias, n])].sort() : form.dias.filter((d) => d !== n))

  const opcionesOrigen = useMemo(
    () => [{ value: SIN_ORIGEN, label: "Cualquiera (sin condición de origen)" }, ...sucursales.map((s) => ({ value: s.slug, label: s.nombre }))],
    [sucursales],
  )

  async function guardar() {
    setGuardando(true)
    setErrores({})
    setAvisos([])
    try {
      const res = await fetch(form.id ? `/api/admin/metodos-envio/${form.id}` : "/api/admin/metodos-envio", {
        method: form.id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formACuerpo(form)),
      })
      const json = (await res.json().catch(() => null)) as
        | { error?: string; campo?: string; propagado?: boolean; metodo?: MetodoEnvioDto; avisos?: string[] }
        | null
      if (!res.ok || !json?.metodo) {
        setErrores({ [json?.campo && json.campo !== "body" ? json.campo : "general"]: json?.error ?? "No pudimos guardar. Inténtelo nuevamente." })
        return
      }
      setAvisos(json.avisos ?? [])
      if (json.propagado === true) toast({ title: "Método de envío guardado", tone: "success" })
      else toast({ title: "Método de envío guardado", description: "El Shop se actualizará en el próximo ciclo.", tone: "warning" })
      onGuardado(json.metodo)
    } catch {
      setErrores({ general: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar() {
    if (!form.id) return
    setGuardando(true)
    try {
      const res = await fetch(`/api/admin/metodos-envio/${form.id}`, { method: "DELETE" })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setErrores({ general: json?.error ?? "No pudimos eliminar el método. Inténtelo nuevamente." })
        return
      }
      toast({ title: "Método de envío eliminado", tone: "success" })
      onEliminado()
    } catch {
      setErrores({ general: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      setGuardando(false)
    }
  }

  const localidadSugerida = (form.localidades[0]?.etiqueta ?? "").split("—")[0].replace(/\([^)]*\)/g, "").trim()

  return (
    <div className="flex flex-col gap-6">
      {errores.general && (
        <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
          {errores.general}
        </p>
      )}
      {avisos.length > 0 && (
        <Alert tone="warning" title="Revise las zonas">
          <ul className="list-disc pl-5">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Alert>
      )}

      <section className="flex flex-col gap-3">
        <h3 className={TITULO} style={{ color: "var(--ink-faint)" }}>
          Datos del método
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Nombre" hint="Es el nombre que ve el cliente." error={errores.nombre}>
            <Input value={form.nombre} onChange={(e) => cambiar("nombre", e.target.value)} aria-invalid={Boolean(errores.nombre)} />
          </Field>
          <Field label="Provincia" hint="El método sólo aplica en esta provincia." error={errores.provincia}>
            <Select
              options={PROVINCIAS.map((p) => ({ value: p, label: p }))}
              value={form.provincia}
              onValueChange={(v) => cambiar("provincia", v)}
              aria-label="Provincia del método"
            />
          </Field>
          <Field label="Sucursal de origen" hint="Sólo se ofrece si todos los productos salen de esta sucursal." error={errores.sucursalOrigen}>
            <Select
              options={opcionesOrigen}
              value={form.sucursalOrigen || SIN_ORIGEN}
              onValueChange={(v) => cambiar("sucursalOrigen", v === SIN_ORIGEN ? "" : v)}
              aria-label="Sucursal de origen"
            />
          </Field>
          <Field label="Promesa" hint="Por ejemplo: Entrega en el día." error={errores.promesa}>
            <Input value={form.promesa} onChange={(e) => cambiar("promesa", e.target.value)} />
          </Field>
        </div>

        <Field label="Días de entrega" error={errores.diasOperativos}>
          <div className="flex flex-wrap gap-4" role="group" aria-label="Días de entrega">
            {DIAS.map((d) => (
              <label key={d.n} htmlFor={`dia-${d.n}`} className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                <Checkbox id={`dia-${d.n}`} checked={form.dias.includes(d.n)} onCheckedChange={(v) => alternarDia(d.n, v)} />
                {d.nombre}
              </label>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Hora de corte" hint="Formato HH:MM, por ejemplo 09:00. Lo confirmado antes se entrega el mismo día." error={errores.horaCorte}>
            <Input value={form.horaCorte} onChange={(e) => cambiar("horaCorte", e.target.value)} placeholder="09:00" aria-invalid={Boolean(errores.horaCorte)} />
          </Field>
          <Field label="Margen (minutos)" hint="Minutos antes del corte en los que ya no se promete el mismo día." error={errores.margenMin}>
            <Input inputMode="numeric" value={form.margenMin} onChange={(e) => cambiar("margenMin", e.target.value)} aria-invalid={Boolean(errores.margenMin)} />
          </Field>
          <Field label="Aviso de feriados" hint="Opcional. Se muestra junto a la promesa." error={errores.avisoFeriados}>
            <Input
              value={form.avisoFeriados}
              onChange={(e) => cambiar("avisoFeriados", e.target.value)}
              placeholder="Los feriados pueden modificar la fecha de entrega."
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field
            label="Horario de entrega"
            hint="Opcional. Cómo se lee en la tienda: Llega hoy antes de las 21 hs"
            error={errores.horarioEntrega}
          >
            <Input
              value={form.horarioEntrega}
              maxLength={MAX_HORARIO_ENTREGA}
              onChange={(e) => cambiar("horarioEntrega", e.target.value)}
              placeholder="antes de las 21 hs"
              aria-invalid={Boolean(errores.horarioEntrega)}
            />
          </Field>
        </div>

        <Field
          label="Feriados (no se entrega)"
          hint={`Opcional. En estas fechas no se entrega y el pedido pasa al siguiente día de entrega. Hasta ${MAX_FERIADOS} fechas.`}
          error={errores.feriados}
        >
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={nuevoFeriado}
                onChange={(e) => setNuevoFeriado(e.target.value)}
                aria-label="Fecha del feriado"
                className="max-w-[12rem]"
              />
              <Button type="button" variant="outline" size="sm" onClick={agregarFeriado} disabled={!esFechaIso(nuevoFeriado)}>
                Agregar feriado
              </Button>
            </div>
            {form.feriados.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Feriados cargados">
                {form.feriados.map((f) => (
                  <li key={f} className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm" style={{ color: "var(--ink)" }}>
                    <span>{f.split("-").reverse().join("/")}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => quitarFeriado(f)} aria-label={`Quitar el feriado ${f.split("-").reverse().join("/")}`}>
                      Quitar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Ítem de Alegra del envío" hint="Id del servicio “Envío” en Alegra. Es obligatorio para activar el método." error={errores.itemAlegraId}>
            <Input value={form.itemAlegraId} onChange={(e) => cambiar("itemAlegraId", e.target.value)} aria-invalid={Boolean(errores.itemAlegraId)} />
          </Field>
          <Field label="IVA del envío (%)" hint="Confirme la alícuota con su contador." error={errores.itemAlegraIva}>
            <Input inputMode="decimal" value={form.itemAlegraIva} onChange={(e) => cambiar("itemAlegraIva", e.target.value)} />
          </Field>
        </div>

        <Switch
          id="metodo-gratis"
          checked={form.gratisAplica}
          onCheckedChange={(v) => cambiar("gratisAplica", v)}
          label={form.gratisAplica ? "El envío gratis aplica a este método" : "El envío gratis no anula la tarifa de este método"}
        />
        <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
          Con esta opción apagada, ni la regla de envío gratis de la tienda ni los cupones de envío gratis eliminan la tarifa de las zonas.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className={TITULO} style={{ color: "var(--ink-faint)" }}>
          Zonas y precios
        </h3>
        <ZonasEnvioEditor
          zonas={form.zonas}
          onChange={(zonas) => {
            setForm((f) => ({ ...f, zonas }))
            setErrores((e) => ({ ...e, zonas: "" }))
          }}
          seleccionada={seleccionada}
          onSeleccionar={setSeleccionada}
          punto={punto}
          zonaResaltada={resaltada}
          errores={errores}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className={TITULO} style={{ color: "var(--ink-faint)" }}>
          Localidades que atiende
        </h3>
        <LocalidadesAtendidasEditor localidades={form.localidades} onChange={(l) => cambiar("localidades", l)} />
        {errores.localidades && (
          <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
            {errores.localidades}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className={TITULO} style={{ color: "var(--ink-faint)" }}>
          Prueba de dirección
        </h3>
        <PruebaDireccionPanel
          cuerpoMetodo={() => formACuerpo(form)}
          localidadSugerida={localidadSugerida}
          provincia={form.provincia}
          zonaDeCuerpo={(nombre) => form.zonas.find((z) => z.nombre === nombre)?.clave ?? null}
          onPunto={setPunto}
          onZona={setResaltada}
        />
      </section>

      <section className="flex flex-col gap-2">
        <Switch
          id="metodo-activo"
          checked={form.activo}
          onCheckedChange={(v) => cambiar("activo", v)}
          label={form.activo ? "Activo: la tienda lo ofrece (cuando el envío por zona esté habilitado)" : "Inactivo: la tienda no lo ofrece"}
        />
        {errores.activo && (
          <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
            {errores.activo}
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void guardar()} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar método"}
        </Button>
        <Button variant="ghost" onClick={onCancelar} disabled={guardando}>
          Cerrar
        </Button>
        {form.id && (
          <Button variant="danger" onClick={() => void eliminar()} disabled={guardando || form.activo} title={form.activo ? "Desactive el método para poder eliminarlo" : undefined}>
            Eliminar método
          </Button>
        )}
      </div>
    </div>
  )
}
