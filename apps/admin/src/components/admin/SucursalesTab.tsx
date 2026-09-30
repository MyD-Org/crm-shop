"use client"

import { useState } from "react"
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, Select, Table, Textarea, useToast } from "@myd-org/ui"
import type { SucursalDto, ZonaDto } from "@/lib/sucursales-repo"
import type { CuentaDto, CuentasYAsignaciones } from "@/lib/alegra-cuentas-repo"
import { formatearCuit, validarCuentaEntrada, type ModoCuenta } from "@/lib/alegra-cuentas-validacion"
import { PROVINCIAS, claveProvincia } from "@/lib/provincias"
import { ReglasVentaCard } from "./ReglasVentaCard"
import { MediosPagoShopCard } from "./MediosPagoShopCard"
import { validarSucursalCambios, validarSucursalNueva, validarZona } from "@/lib/sucursales-validacion"

// Configuración → Sucursales y ventas (parte A): ABM de sucursales y de zonas (provincia ->
// sucursal). La sucursal es la unidad comercial (retiro, envío, zona); la cuenta de Alegra que
// factura se asigna en otra etapa. Los cambios rigen para los pedidos nuevos y no alteran los ya
// creados. Cada guardado avisa al Shop; si el aviso no llegó (`propagado: false`) el cambio igual
// quedó guardado y el Shop lo toma en su próximo ciclo.
//
// Los datos reales (direcciones, WhatsApp, horarios) se cargan acá, nunca en el repo.

// Cuenta de Alegra por sucursal (rebanada D): el token es write-only (el servidor nunca lo
// devuelve; solo informa si está configurado y sus últimos 4 caracteres).
interface Props {
  initialSucursales: SucursalDto[]
  initialZonas: ZonaDto[]
  initialCuentas: CuentasYAsignaciones
}

type ApiError = { error?: string; code?: string; campo?: string }
type Errores = Record<string, string>

type SucursalForm = {
  // `editandoSlug` presente = edición (el identificador no se puede cambiar).
  editandoSlug?: string
  slug: string
  nombre: string
  direccion: string
  ciudad: string
  provincia: string
  whatsapp: string
  horario: string
  envioCiudades: string
  orden: string
  aceptaRetiro: boolean
  aceptaEnvio: boolean
  activa: boolean
  predeterminada: boolean
  maestra: boolean
}

type ZonaForm = { provincia: string; sucursal: string; facturaSucursal: string }

type CuentaForm = {
  sucursal: SucursalDto
  modo: ModoCuenta
  email: string
  token: string
  cuit: string
  // Ya tiene una cuenta propia guardada: el token vacío conserva el guardado.
  tieneCuentaPropia: boolean
  tokenConfigurado: boolean
  tokenUltimos4: string | null
}

type Prueba = { ok: boolean; mensaje: string }

const MODOS_CUENTA = [
  { value: "ninguna", label: "Sin cuenta asignada" },
  { value: "principal", label: "Cuenta principal del negocio" },
  { value: "propia", label: "Cuenta propia de la sucursal" },
]

const SIN_PROVINCIA = "__sin_provincia"
const SIN_FACTURA = "__sin_factura"

const sucursalVacia = (orden: number): SucursalForm => ({
  slug: "",
  nombre: "",
  direccion: "",
  ciudad: "",
  provincia: "",
  whatsapp: "",
  horario: "",
  envioCiudades: "",
  orden: String(orden),
  aceptaRetiro: true,
  aceptaEnvio: true,
  activa: true,
  predeterminada: false,
  maestra: false,
})

const desdeDto = (s: SucursalDto): SucursalForm => ({
  editandoSlug: s.slug,
  slug: s.slug,
  nombre: s.nombre,
  direccion: s.direccion,
  ciudad: s.ciudad,
  provincia: s.provincia,
  whatsapp: s.whatsapp,
  horario: s.horario,
  envioCiudades: s.envioCiudades.join(", "),
  orden: String(s.orden),
  aceptaRetiro: s.aceptaRetiro,
  aceptaEnvio: s.aceptaEnvio,
  activa: s.activa,
  predeterminada: s.predeterminada,
  maestra: s.maestra,
})

function cuerpoSucursal(f: SucursalForm) {
  return {
    ...(f.editandoSlug ? {} : { slug: f.slug.trim() }),
    nombre: f.nombre,
    direccion: f.direccion,
    ciudad: f.ciudad,
    provincia: f.provincia,
    whatsapp: f.whatsapp,
    horario: f.horario,
    envioCiudades: f.envioCiudades.split(",").map((c) => c.trim()).filter(Boolean),
    orden: f.orden.trim() === "" ? 0 : Number(f.orden),
    aceptaRetiro: f.aceptaRetiro,
    aceptaEnvio: f.aceptaEnvio,
    activa: f.activa,
    predeterminada: f.predeterminada,
    maestra: f.maestra,
  }
}

async function enviar(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as (ApiError & Record<string, unknown>) | null
  return { res, json }
}

function CheckboxLabel(props: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={props.id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--ink)" }}>
        <Checkbox id={props.id} checked={props.checked} onCheckedChange={props.onChange} />
        {props.label}
      </label>
      {props.hint && (
        <p className="text-xs pl-6" style={{ color: "var(--ink-soft)" }}>
          {props.hint}
        </p>
      )}
    </div>
  )
}

const porOrden = (a: SucursalDto, b: SucursalDto) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)

export function SucursalesTab({ initialSucursales, initialZonas, initialCuentas }: Props) {
  const [sucursales, setSucursales] = useState(initialSucursales)
  const [zonas, setZonas] = useState(initialZonas)
  const [cuentas, setCuentas] = useState(initialCuentas)
  const [cuentaForm, setCuentaForm] = useState<CuentaForm | null>(null)
  const [prueba, setPrueba] = useState<Prueba | null>(null)
  const [probando, setProbando] = useState(false)
  const [sucursalForm, setSucursalForm] = useState<SucursalForm | null>(null)
  const [zonaForm, setZonaForm] = useState<ZonaForm | null>(null)
  const [borrarSucursal, setBorrarSucursal] = useState<SucursalDto | null>(null)
  const [borrarZona, setBorrarZona] = useState<ZonaDto | null>(null)
  const [errores, setErrores] = useState<Errores>({})
  const [guardando, setGuardando] = useState(false)
  const { toast } = useToast()

  const cuentaDe = (slugSucursal: string): CuentaDto | undefined => {
    const slugCuenta = cuentas.asignaciones[slugSucursal]
    return slugCuenta ? cuentas.cuentas.find((c) => c.slug === slugCuenta) : undefined
  }

  const abrirCuenta = (s: SucursalDto) => {
    const c = cuentaDe(s.slug)
    setErrores({})
    setPrueba(null)
    setCuentaForm({
      sucursal: s,
      modo: !c ? "ninguna" : c.principal ? "principal" : "propia",
      email: c && !c.principal ? c.email : "",
      token: "",
      cuit: c ? formatearCuit(c.cuit) : "",
      tieneCuentaPropia: Boolean(c && !c.principal),
      tokenConfigurado: Boolean(c && !c.principal && c.tokenConfigurado),
      tokenUltimos4: c && !c.principal ? c.tokenUltimos4 : null,
    })
  }

  function cuerpoCuenta(f: CuentaForm) {
    return {
      modo: f.modo,
      ...(f.modo === "ninguna" ? {} : { cuit: f.cuit }),
      ...(f.modo === "propia" ? { email: f.email, token: f.token } : {}),
    }
  }

  async function recargarCuentas() {
    try {
      const { res, json } = await enviar("/api/admin/alegra-cuentas", "GET")
      if (res.ok && json) setCuentas(json as unknown as CuentasYAsignaciones)
    } catch {
      // Queda como estaba: el guardado ya se hizo.
    }
  }

  async function guardarCuenta() {
    if (!cuentaForm) return
    setErrores({})
    const cuerpo = cuerpoCuenta(cuentaForm)
    const v = validarCuentaEntrada(cuerpo, { esAlta: !cuentaForm.tieneCuentaPropia })
    if (!v.ok) return setErrores({ [v.campo === "body" ? "general" : v.campo]: v.error })

    setGuardando(true)
    try {
      const { res, json } = await enviar(`/api/admin/sucursales/${cuentaForm.sucursal.slug}/cuenta-alegra`, "PUT", cuerpo)
      if (!res.ok || !json) return manejarError(res, json)
      await recargarCuentas()
      setCuentaForm(null)
      toast({ title: "Cuenta de Alegra guardada", tone: "success" })
    } catch {
      setErrores({ general: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      setGuardando(false)
    }
  }

  async function probarCuenta() {
    if (!cuentaForm) return
    setPrueba(null)
    setProbando(true)
    try {
      const propia = cuentaForm.modo === "propia"
      const { res, json } = await enviar(
        `/api/admin/sucursales/${cuentaForm.sucursal.slug}/cuenta-alegra/probar`,
        "POST",
        propia ? { email: cuentaForm.email, token: cuentaForm.token } : {},
      )
      if (!res.ok || !json) {
        setPrueba({ ok: false, mensaje: json?.error ?? "No pudimos probar la conexión. Inténtelo nuevamente." })
        return
      }
      setPrueba(
        json.ok === true
          ? { ok: true, mensaje: "La conexión con Alegra funciona correctamente." }
          : { ok: false, mensaje: typeof json.mensaje === "string" ? json.mensaje : "No pudimos conectarnos con Alegra." },
      )
    } catch {
      setPrueba({ ok: false, mensaje: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      setProbando(false)
    }
  }

  const nombreDe = (slug: string | null) => (slug ? sucursales.find((s) => s.slug === slug)?.nombre ?? slug : "")
  const predeterminada = sucursales.find((s) => s.predeterminada)
  const zonasOrdenadas = [...zonas].sort((a, b) => a.provincia.localeCompare(b.provincia))

  function avisarGuardado(titulo: string, propagado: unknown) {
    if (propagado === true) toast({ title: titulo, tone: "success" })
    else toast({ title: titulo, description: "El Shop se actualizará en el próximo ciclo.", tone: "warning" })
  }

  function manejarError(res: Response, json: ApiError | null) {
    if (res.status === 403) setErrores({ general: json?.error ?? "No tiene permiso para realizar esta acción." })
    else if (res.status === 404) setErrores({ general: "No encontramos ese registro. Recargue la página." })
    else if ((res.status === 400 || res.status === 409) && json?.error) {
      setErrores({ [json.campo && json.campo !== "body" ? json.campo : "general"]: json.error })
    } else setErrores({ general: json?.error ?? "No pudimos guardar. Inténtelo nuevamente." })
  }

  /** Tras un alta/cambio con marcas únicas, el servidor puede haber transferido otra sucursal. */
  async function recargarSucursales() {
    try {
      const { res, json } = await enviar("/api/admin/sucursales", "GET")
      if (res.ok && json) setSucursales((json.sucursales as SucursalDto[]).slice().sort(porOrden))
    } catch {
      // La lista queda como estaba: el guardado ya se hizo.
    }
  }

  async function guardarSucursal() {
    if (!sucursalForm) return
    setErrores({})
    const cuerpo = cuerpoSucursal(sucursalForm)
    // Misma validación que el servidor: el mensaje es el mismo y se evita el viaje.
    const v = sucursalForm.editandoSlug ? validarSucursalCambios(cuerpo) : validarSucursalNueva(cuerpo)
    if (!v.ok) return setErrores({ [v.campo === "body" ? "general" : v.campo]: v.error })

    setGuardando(true)
    try {
      const { res, json } = sucursalForm.editandoSlug
        ? await enviar(`/api/admin/sucursales/${sucursalForm.editandoSlug}`, "PATCH", cuerpo)
        : await enviar("/api/admin/sucursales", "POST", cuerpo)
      if (!res.ok || !json) return manejarError(res, json)
      const nueva = json.sucursal as SucursalDto
      setSucursales((prev) => [...prev.filter((s) => s.slug !== nueva.slug), nueva].sort(porOrden))
      setSucursalForm(null)
      avisarGuardado(sucursalForm.editandoSlug ? "Sucursal actualizada" : "Sucursal agregada", json.propagado)
      if (nueva.predeterminada || nueva.maestra) await recargarSucursales()
    } catch {
      setErrores({ general: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      setGuardando(false)
    }
  }

  async function alternarActiva(s: SucursalDto) {
    try {
      const { res, json } = await enviar(`/api/admin/sucursales/${s.slug}`, "PATCH", { activa: !s.activa })
      if (!res.ok || !json) {
        toast({ title: json?.error ?? "No pudimos actualizar la sucursal.", tone: "danger" })
        return
      }
      const nueva = json.sucursal as SucursalDto
      setSucursales((prev) => prev.map((x) => (x.slug === nueva.slug ? nueva : x)))
      avisarGuardado(nueva.activa ? "Sucursal activada" : "Sucursal desactivada", json.propagado)
    } catch {
      toast({ title: "Error de conexión. Inténtelo nuevamente.", tone: "danger" })
    }
  }

  async function confirmarBorrarSucursal() {
    if (!borrarSucursal) return
    setGuardando(true)
    try {
      const { res, json } = await enviar(`/api/admin/sucursales/${borrarSucursal.slug}`, "DELETE")
      if (!res.ok && res.status !== 404) {
        toast({ title: json?.error ?? "No pudimos eliminar la sucursal.", tone: "danger" })
        setBorrarSucursal(null)
        return
      }
      setSucursales((prev) => prev.filter((s) => s.slug !== borrarSucursal.slug))
      setBorrarSucursal(null)
      if (res.ok) avisarGuardado("Sucursal eliminada", json?.propagado)
    } catch {
      toast({ title: "Error de conexión. Inténtelo nuevamente.", tone: "danger" })
    } finally {
      setGuardando(false)
    }
  }

  async function guardarZona() {
    if (!zonaForm) return
    setErrores({})
    const cuerpo = {
      provincia: zonaForm.provincia,
      sucursal: zonaForm.sucursal,
      facturaSucursal: zonaForm.facturaSucursal || null,
    }
    const v = validarZona(cuerpo)
    if (!v.ok) return setErrores({ [v.campo === "body" ? "general" : v.campo]: v.error })

    setGuardando(true)
    try {
      const { res, json } = await enviar("/api/admin/sucursales/zonas", "PUT", cuerpo)
      if (!res.ok || !json) return manejarError(res, json)
      const zona = json.zona as ZonaDto
      setZonas((prev) => [...prev.filter((z) => z.provinciaClave !== zona.provinciaClave), zona])
      setZonaForm(null)
      avisarGuardado("Zona guardada", json.propagado)
    } catch {
      setErrores({ general: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      setGuardando(false)
    }
  }

  async function confirmarBorrarZona() {
    if (!borrarZona) return
    setGuardando(true)
    try {
      const { res, json } = await enviar(`/api/admin/sucursales/zonas/${borrarZona.provinciaClave}`, "DELETE")
      if (!res.ok && res.status !== 404) {
        toast({ title: json?.error ?? "No pudimos quitar la zona.", tone: "danger" })
        setBorrarZona(null)
        return
      }
      setZonas((prev) => prev.filter((z) => z.provinciaClave !== borrarZona.provinciaClave))
      setBorrarZona(null)
      if (res.ok) avisarGuardado("Zona quitada", json?.propagado)
    } catch {
      toast({ title: "Error de conexión. Inténtelo nuevamente.", tone: "danger" })
    } finally {
      setGuardando(false)
    }
  }

  const setS = (patch: Partial<SucursalForm>) => setSucursalForm((f) => (f ? { ...f, ...patch } : f))
  const setZ = (patch: Partial<ZonaForm>) => setZonaForm((f) => (f ? { ...f, ...patch } : f))
  const abrirSucursal = (f: SucursalForm) => {
    setErrores({})
    setSucursalForm(f)
  }
  const abrirZona = (f: ZonaForm) => {
    setErrores({})
    setZonaForm(f)
  }

  const opcionesSucursal = sucursales.filter((s) => s.activa).map((s) => ({ value: s.slug, label: s.nombre }))
  const opcionesProvincia = PROVINCIAS.map((p) => ({ value: p, label: p }))
  const provinciasConZona = new Set(zonas.map((z) => z.provinciaClave))

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Sucursales"
        description="Cada sucursal define un local de retiro y un origen de envío. Los cambios rigen para los pedidos nuevos; los pedidos ya creados conservan su sucursal."
      >
        <div className="flex flex-col gap-3">
          <Table<SucursalDto>
            rows={sucursales}
            rowKey={(s) => s.slug}
            empty={
              <p className="text-sm py-4" style={{ color: "var(--ink-soft)" }}>
                Todavía no hay sucursales. Agregue la primera: quedará como predeterminada.
              </p>
            }
            columns={[
              {
                key: "nombre",
                header: "Sucursal",
                render: (s) => (
                  <div className="flex flex-col">
                    <span>{s.nombre}</span>
                    <span className="text-xs" style={{ color: "var(--ink-soft)" }}>{s.slug}</span>
                  </div>
                ),
              },
              {
                key: "marcas",
                header: "Rol",
                render: (s) => (
                  <div className="flex gap-1 flex-wrap">
                    {s.predeterminada && <Badge tone="info">Predeterminada</Badge>}
                    {s.maestra && <Badge tone="info">Principal</Badge>}
                  </div>
                ),
                hideBelow: "sm",
              },
              {
                key: "cuenta",
                header: "Cuenta de Alegra",
                render: (s) => {
                  const c = cuentaDe(s.slug)
                  if (!c) return <span style={{ color: "var(--ink-soft)" }}>Sin asignar</span>
                  return c.principal ? "Principal del negocio" : c.nombre
                },
                hideBelow: "md",
              },
              {
                key: "modalidad",
                header: "Retiro / envío",
                render: (s) => [s.aceptaRetiro ? "Retiro" : null, s.aceptaEnvio ? "Envío" : null].filter(Boolean).join(" y ") || "Ninguno",
                hideBelow: "md",
              },
              {
                key: "estado",
                header: "Estado",
                render: (s) => <Badge tone={s.activa ? "success" : "neutral"}>{s.activa ? "Activa" : "Inactiva"}</Badge>,
              },
              {
                key: "acciones",
                header: "",
                align: "right",
                render: (s) => (
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => abrirSucursal(desdeDto(s))}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => abrirCuenta(s)}>
                      Cuenta de Alegra
                    </Button>
                    {!s.predeterminada && (
                      <Button size="sm" variant="ghost" onClick={() => alternarActiva(s)}>
                        {s.activa ? "Desactivar" : "Activar"}
                      </Button>
                    )}
                    {!s.predeterminada && (
                      <Button size="sm" variant="ghost" onClick={() => setBorrarSucursal(s)}>
                        Eliminar
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
          <div>
            <Button variant="secondary" onClick={() => abrirSucursal(sucursalVacia(sucursales.length))}>
              Agregar sucursal
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title="Zonas de venta"
        description={
          predeterminada
            ? `Cada provincia se asigna a una sucursal. Las provincias sin zona se asignan a ${predeterminada.nombre} (predeterminada).`
            : "Cada provincia se asigna a una sucursal. Las provincias sin zona se asignan a la sucursal predeterminada."
        }
      >
        <div className="flex flex-col gap-3">
          <Table<ZonaDto>
            rows={zonasOrdenadas}
            rowKey={(z) => z.provinciaClave}
            empty={
              <p className="text-sm py-4" style={{ color: "var(--ink-soft)" }}>
                Todavía no hay zonas: todas las provincias se asignan a la sucursal predeterminada.
              </p>
            }
            columns={[
              { key: "provincia", header: "Provincia", render: (z) => z.provincia },
              { key: "sucursal", header: "Sucursal", render: (z) => nombreDe(z.sucursal) },
              {
                key: "factura",
                header: "Factura",
                render: (z) => (z.facturaSucursal ? nombreDe(z.facturaSucursal) : "La que despacha"),
                hideBelow: "md",
              },
              {
                key: "acciones",
                header: "",
                align: "right",
                render: (z) => (
                  <div className="flex gap-1 justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => abrirZona({ provincia: z.provincia, sucursal: z.sucursal, facturaSucursal: z.facturaSucursal ?? "" })}
                    >
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setBorrarZona(z)}>
                      Quitar
                    </Button>
                  </div>
                ),
              },
            ]}
          />
          <div>
            <Button
              variant="secondary"
              disabled={sucursales.length === 0}
              onClick={() => abrirZona({ provincia: "", sucursal: "", facturaSucursal: "" })}
            >
              Agregar zona
            </Button>
          </div>
        </div>
      </Card>

      <ReglasVentaCard />

      <MediosPagoShopCard />

      <Dialog
        open={sucursalForm !== null}
        onOpenChange={(open) => {
          if (!open) setSucursalForm(null)
        }}
        title={sucursalForm?.editandoSlug ? "Editar sucursal" : "Agregar sucursal"}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setSucursalForm(null)}>Cancelar</Button>
            <Button loading={guardando} disabled={guardando} onClick={guardarSucursal}>Guardar</Button>
          </div>
        }
      >
        {sucursalForm && (
          <div className="flex flex-col gap-3">
            <Field
              label="Identificador"
              hint="De 2 a 20 caracteres: minúsculas, números o guiones. No se puede cambiar después."
              error={errores.slug}
            >
              <Input
                value={sucursalForm.slug}
                disabled={Boolean(sucursalForm.editandoSlug)}
                onChange={(e) => setS({ slug: e.target.value })}
                aria-invalid={Boolean(errores.slug)}
              />
            </Field>
            <Field label="Nombre" error={errores.nombre}>
              <Input value={sucursalForm.nombre} onChange={(e) => setS({ nombre: e.target.value })} aria-invalid={Boolean(errores.nombre)} />
            </Field>
            <Field label="Dirección de retiro" error={errores.direccion}>
              <Input value={sucursalForm.direccion} onChange={(e) => setS({ direccion: e.target.value })} aria-invalid={Boolean(errores.direccion)} />
            </Field>
            <Field label="Ciudad" error={errores.ciudad}>
              <Input value={sucursalForm.ciudad} onChange={(e) => setS({ ciudad: e.target.value })} aria-invalid={Boolean(errores.ciudad)} />
            </Field>
            <Field label="Provincia" error={errores.provincia}>
              <Select
                options={[{ value: SIN_PROVINCIA, label: "Sin especificar" }, ...opcionesProvincia]}
                value={sucursalForm.provincia || SIN_PROVINCIA}
                onValueChange={(v) => setS({ provincia: v === SIN_PROVINCIA ? "" : v })}
                aria-label="Provincia"
                aria-invalid={Boolean(errores.provincia)}
              />
            </Field>
            <Field label="WhatsApp" hint="Con código de país y de área, solo números." error={errores.whatsapp}>
              <Input
                inputMode="tel"
                value={sucursalForm.whatsapp}
                onChange={(e) => setS({ whatsapp: e.target.value })}
                aria-invalid={Boolean(errores.whatsapp)}
              />
            </Field>
            <Field label="Horario de atención" error={errores.horario}>
              <Textarea value={sucursalForm.horario} rows={3} onChange={(e) => setS({ horario: e.target.value })} aria-invalid={Boolean(errores.horario)} />
            </Field>
            <Field
              label="Ciudades de envío"
              hint="Separadas por coma. Vacío = toda la zona de la sucursal."
              error={errores.envioCiudades}
            >
              <Input
                value={sucursalForm.envioCiudades}
                onChange={(e) => setS({ envioCiudades: e.target.value })}
                aria-invalid={Boolean(errores.envioCiudades)}
              />
            </Field>
            <Field label="Orden" hint="Menor primero. Define la sucursal de respaldo." error={errores.orden}>
              <Input type="number" min={0} step={1} value={sucursalForm.orden} onChange={(e) => setS({ orden: e.target.value })} aria-invalid={Boolean(errores.orden)} />
            </Field>
            <CheckboxLabel id="suc-retiro" checked={sucursalForm.aceptaRetiro} onChange={(aceptaRetiro) => setS({ aceptaRetiro })} label="Acepta retiro en el local" />
            <CheckboxLabel id="suc-envio" checked={sucursalForm.aceptaEnvio} onChange={(aceptaEnvio) => setS({ aceptaEnvio })} label="Realiza envíos" />
            <CheckboxLabel id="suc-activa" checked={sucursalForm.activa} onChange={(activa) => setS({ activa })} label="Activa" />
            <CheckboxLabel
              id="suc-pred"
              checked={sucursalForm.predeterminada}
              onChange={(predeterminada) => setS({ predeterminada })}
              label="Predeterminada"
              hint="Recibe las provincias sin zona. Si ya hay otra, la marca se transfiere a esta."
            />
            <CheckboxLabel
              id="suc-principal"
              checked={sucursalForm.maestra}
              onChange={(maestra) => setS({ maestra })}
              label="Principal"
              hint="Su cuenta manda en los productos repetidos. Si ya hay otra, la marca se transfiere a esta."
            />
            {(errores.predeterminada || errores.activa) && (
              <p className="text-sm" style={{ color: "var(--red)" }}>{errores.predeterminada ?? errores.activa}</p>
            )}
            {errores.general && <p className="text-sm" style={{ color: "var(--red)" }}>{errores.general}</p>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={zonaForm !== null}
        onOpenChange={(open) => {
          if (!open) setZonaForm(null)
        }}
        title="Zona de venta"
        description="Los pedidos nuevos de esta provincia se asignan a la sucursal elegida."
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setZonaForm(null)}>Cancelar</Button>
            <Button loading={guardando} disabled={guardando} onClick={guardarZona}>Guardar</Button>
          </div>
        }
      >
        {zonaForm && (
          <div className="flex flex-col gap-3">
            <Field
              label="Provincia"
              hint={zonaForm.provincia && provinciasConZona.has(claveProvincia(zonaForm.provincia)) ? "Esta provincia ya tiene zona: al guardar se reemplaza." : undefined}
              error={errores.provincia}
            >
              <Select
                options={opcionesProvincia}
                value={zonaForm.provincia}
                onValueChange={(provincia) => setZ({ provincia })}
                placeholder="Seleccione una provincia"
                aria-label="Provincia"
                aria-invalid={Boolean(errores.provincia)}
              />
            </Field>
            <Field label="Sucursal" error={errores.sucursal}>
              <Select
                options={opcionesSucursal}
                value={zonaForm.sucursal}
                onValueChange={(sucursal) => setZ({ sucursal })}
                placeholder="Seleccione una sucursal"
                aria-label="Sucursal"
                aria-invalid={Boolean(errores.sucursal)}
              />
            </Field>
            <Field
              label="Sucursal que factura"
              hint="Solo si factura una cuenta distinta de la que despacha."
              error={errores.facturaSucursal}
            >
              <Select
                options={[{ value: SIN_FACTURA, label: "La que despacha" }, ...opcionesSucursal]}
                value={zonaForm.facturaSucursal || SIN_FACTURA}
                onValueChange={(v) => setZ({ facturaSucursal: v === SIN_FACTURA ? "" : v })}
                aria-label="Sucursal que factura"
                aria-invalid={Boolean(errores.facturaSucursal)}
              />
            </Field>
            {errores.general && <p className="text-sm" style={{ color: "var(--red)" }}>{errores.general}</p>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={cuentaForm !== null}
        onOpenChange={(open) => {
          if (!open) setCuentaForm(null)
        }}
        title={cuentaForm ? `Cuenta de Alegra de ${cuentaForm.sucursal.nombre}` : "Cuenta de Alegra"}
        description="La cuenta define de dónde se toma el stock de la sucursal y por cuál se factura. El token se guarda en el servidor y no se vuelve a mostrar."
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setCuentaForm(null)}>Cancelar</Button>
            {cuentaForm && cuentaForm.modo !== "ninguna" && (
              <Button variant="secondary" loading={probando} disabled={probando || guardando} onClick={probarCuenta}>
                Probar conexión
              </Button>
            )}
            <Button loading={guardando} disabled={guardando} onClick={guardarCuenta}>Guardar</Button>
          </div>
        }
      >
        {cuentaForm && (
          <div className="flex flex-col gap-3">
            <Field label="Cuenta" error={errores.modo}>
              <Select
                options={MODOS_CUENTA}
                value={cuentaForm.modo}
                onValueChange={(modo) => {
                  setPrueba(null)
                  setCuentaForm((f) => (f ? { ...f, modo: modo as ModoCuenta } : f))
                }}
                aria-label="Cuenta"
              />
            </Field>
            {cuentaForm.modo === "principal" && (
              <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
                Usa las credenciales de Alegra del negocio, que ya están cargadas en la configuración general.
              </p>
            )}
            {cuentaForm.modo === "propia" && (
              <>
                <Field label="Correo de Alegra" error={errores.email}>
                  <Input
                    type="email"
                    autoComplete="off"
                    value={cuentaForm.email}
                    onChange={(e) => setCuentaForm((f) => (f ? { ...f, email: e.target.value } : f))}
                    aria-invalid={Boolean(errores.email)}
                  />
                </Field>
                <Field
                  label="Token de Alegra"
                  hint={
                    cuentaForm.tokenConfigurado
                      ? `Token configurado${cuentaForm.tokenUltimos4 ? ` (termina en ${cuentaForm.tokenUltimos4})` : ""}. Déjelo vacío para conservarlo.`
                      : "Se obtiene en Alegra, en la configuración de la cuenta."
                  }
                  error={errores.token}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={cuentaForm.token}
                    onChange={(e) => setCuentaForm((f) => (f ? { ...f, token: e.target.value } : f))}
                    aria-invalid={Boolean(errores.token)}
                  />
                </Field>
              </>
            )}
            {cuentaForm.modo !== "ninguna" && (
              <Field label="CUIT" hint="11 dígitos. Es el de la empresa que factura con esta cuenta." error={errores.cuit}>
                <Input
                  inputMode="numeric"
                  value={cuentaForm.cuit}
                  onChange={(e) => setCuentaForm((f) => (f ? { ...f, cuit: e.target.value } : f))}
                  aria-invalid={Boolean(errores.cuit)}
                />
              </Field>
            )}
            {prueba && (
              <p className="text-sm" role="status" style={{ color: prueba.ok ? "var(--green)" : "var(--red)" }}>
                {prueba.mensaje}
              </p>
            )}
            {errores.general && <p className="text-sm" style={{ color: "var(--red)" }}>{errores.general}</p>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={borrarSucursal !== null}
        onOpenChange={(open) => {
          if (!open) setBorrarSucursal(null)
        }}
        title="Eliminar sucursal"
        description="Se elimina definitivamente. Si solo quiere dejar de usarla, desactívela: así se conserva el historial de pedidos."
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setBorrarSucursal(null)}>Cancelar</Button>
            <Button variant="danger" loading={guardando} onClick={confirmarBorrarSucursal}>Eliminar</Button>
          </div>
        }
      >
        {borrarSucursal && <p className="text-sm" style={{ color: "var(--ink)" }}>¿Eliminar la sucursal &quot;{borrarSucursal.nombre}&quot;?</p>}
      </Dialog>

      <Dialog
        open={borrarZona !== null}
        onOpenChange={(open) => {
          if (!open) setBorrarZona(null)
        }}
        title="Quitar zona"
        description="Desde ese momento, los pedidos nuevos de esa provincia se asignan a la sucursal predeterminada."
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setBorrarZona(null)}>Cancelar</Button>
            <Button variant="danger" loading={guardando} onClick={confirmarBorrarZona}>Quitar</Button>
          </div>
        }
      >
        {borrarZona && <p className="text-sm" style={{ color: "var(--ink)" }}>¿Quitar la zona de {borrarZona.provincia}?</p>}
      </Dialog>
    </div>
  )
}
