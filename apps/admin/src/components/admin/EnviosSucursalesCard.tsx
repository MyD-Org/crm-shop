"use client"

import { useCallback, useEffect, useState } from "react"
import { Badge, Button, Card, Field, RadioGroup, SegmentedControl, Select, Switch, useToast } from "@myd-org/ui"
import type { SucursalDto, ZonaDto } from "@/lib/sucursales-repo"
import type { ReglasVenta } from "@/lib/reglas-venta-validacion"
import { PROVINCIAS, claveProvincia } from "@/lib/provincias"
import { HINT_SUCURSAL_QUE_FACTURA } from "@/lib/sucursales-texto"
import {
  asignarProvincia,
  ciudadesQueSonProvincias,
  enumerar,
  planZonas,
  provinciasLibres,
  resumenSucursal,
  type ZonaEditable,
} from "@/lib/zonas-envios"
import { CiudadesEnvioSelector } from "@/components/admin/CiudadesEnvioSelector"

// Envíos: «Zonas y envíos». En una sola tarjeta por sucursal: qué provincias atiende (zonas de
// venta), si envía a domicilio y a qué ciudades, más quién atiende las provincias sin asignar
// (sucursal predeterminada) y el respaldo de stock. Antes las zonas estaban en Sucursales y se
// confundían con las ciudades de envío. Un solo «Guardar» aplica todo con las APIs existentes
// (zonas PUT/DELETE, sucursal PATCH parcial, reglas PUT parcial). Cada guardado avisa al Shop
// (best-effort): si el aviso no llegó, el cambio igual quedó guardado.

type ModoCiudades = "todas" | "algunas"
type FilaForm = {
  slug: string
  nombre: string
  activa: boolean
  aceptaEnvio: boolean
  modo: ModoCiudades
  ciudades: string[]
  original: { aceptaEnvio: boolean; ciudades: string[] }
}
type Errores = Record<string, string>
type Datos = { sucursales: SucursalDto[]; zonas: ZonaDto[]; reglas: ReglasVenta }

const OPCIONES_RESPALDO = [
  {
    value: "si",
    label: "Sí, despachar desde otra sucursal",
    description:
      "Si la sucursal de la zona del cliente no tiene stock de un producto, ese producto se trae de otra sucursal que sí tenga. El pedido se acepta, suma la demora de traslado de Reglas de venta y sigue a cargo de la sucursal de la zona.",
  },
  {
    value: "no",
    label: "No, informar que no hay stock",
    description:
      "Si a la sucursal de la zona le falta stock de algún producto, el checkout lo informa y el cliente debe quitarlo para continuar. Cada sucursal sólo vende lo que tiene.",
  },
]

const OPCIONES_CIUDADES = [
  { value: "todas", label: "A toda su zona" },
  { value: "algunas", label: "Solo a algunas ciudades" },
]

const SIN_FACTURA = "__despacha"
const TITULO = "text-xs font-semibold uppercase tracking-wider"
const ROJO = { color: "var(--red)" }
const SUAVE = { color: "var(--ink-soft)" }

const mismasCiudades = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i])

const aFila = (s: SucursalDto): FilaForm => ({
  slug: s.slug,
  nombre: s.nombre,
  activa: s.activa,
  aceptaEnvio: s.aceptaEnvio,
  modo: s.envioCiudades.length > 0 ? "algunas" : "todas",
  ciudades: [...s.envioCiudades],
  original: { aceptaEnvio: s.aceptaEnvio, ciudades: [...s.envioCiudades] },
})

async function pedir<T>(url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as (T & { error?: string; propagado?: boolean }) | null
  return { res, json }
}

async function cargarDatos(): Promise<Datos | null> {
  const [suc, zon, reg] = await Promise.all([
    pedir<{ sucursales: SucursalDto[] }>("/api/admin/sucursales"),
    pedir<{ zonas: ZonaDto[] }>("/api/admin/sucursales/zonas"),
    pedir<{ reglas: ReglasVenta }>("/api/admin/reglas-venta"),
  ])
  if (!suc.res.ok || !suc.json?.sucursales || !zon.res.ok || !zon.json?.zonas || !reg.res.ok || !reg.json?.reglas) return null
  return { sucursales: suc.json.sucursales, zonas: zon.json.zonas, reglas: reg.json.reglas }
}

export function EnviosSucursalesCard() {
  const [filas, setFilas] = useState<FilaForm[] | null>(null)
  const [zonas, setZonas] = useState<ZonaEditable[]>([])
  const [zonasOriginales, setZonasOriginales] = useState<ZonaEditable[]>([])
  const [predeterminada, setPredeterminada] = useState("")
  const [predeterminadaOriginal, setPredeterminadaOriginal] = useState("")
  const [respaldo, setRespaldo] = useState<"si" | "no">("si")
  const [respaldoOriginal, setRespaldoOriginal] = useState<"si" | "no">("si")
  const [errores, setErrores] = useState<Errores>({})
  const [guardando, setGuardando] = useState(false)
  const [errorCarga, setErrorCarga] = useState(false)
  const { toast } = useToast()

  const aplicar = useCallback((d: Datos) => {
    setFilas(d.sucursales.slice().sort((a, b) => a.orden - b.orden).map(aFila))
    setZonas(d.zonas)
    setZonasOriginales(d.zonas)
    const pred = d.sucursales.find((s) => s.predeterminada)?.slug ?? ""
    setPredeterminada(pred)
    setPredeterminadaOriginal(pred)
    const r = d.reglas.respaldoEnvio ? "si" : "no"
    setRespaldo(r)
    setRespaldoOriginal(r)
  }, [])

  useEffect(() => {
    let vivo = true
    cargarDatos()
      .then((d) => {
        if (!vivo) return
        if (d) aplicar(d)
        else setErrorCarga(true)
      })
      .catch(() => vivo && setErrorCarga(true))
    return () => {
      vivo = false
    }
  }, [aplicar])

  const limpiarError = (clave: string) => setErrores((e) => ({ ...e, [clave]: "", general: "" }))

  const cambiarFila = (slug: string, cambios: Partial<FilaForm>) => {
    setFilas((fs) => (fs ? fs.map((f) => (f.slug === slug ? { ...f, ...cambios } : f)) : fs))
    limpiarError(slug)
  }

  const nombreDe = (slug: string) => filas?.find((f) => f.slug === slug)?.nombre ?? slug
  const activas = (filas ?? []).filter((f) => f.activa)

  function validar(fs: FilaForm[]): Errores {
    const e: Errores = {}
    for (const f of fs) {
      if (!f.aceptaEnvio || f.modo !== "algunas") continue
      const provincias = ciudadesQueSonProvincias(f.ciudades)
      if (provincias.length > 0) {
        e[f.slug] = `${enumerar(provincias.map((p) => `«${p}»`))} es una provincia, no una ciudad. Quítela de esta lista y asígnela en «Provincias que atiende».`
      } else if (f.ciudades.length === 0) {
        e[f.slug] = "Agregue al menos una ciudad o elija «A toda su zona»."
      }
    }
    return e
  }

  async function guardar() {
    if (!filas) return
    const previos = validar(filas)
    if (Object.keys(previos).length > 0) {
      setErrores(previos)
      return
    }
    setGuardando(true)
    setErrores({})
    const nuevos: Errores = {}
    let propagadoTodo = true
    let hubo = false
    const anotar = (json: { propagado?: boolean } | null) => {
      hubo = true
      if (json?.propagado !== true) propagadoTodo = false
    }

    try {
      // 1. Quién atiende las provincias sin asignar (el servidor transfiere la marca).
      if (predeterminada && predeterminada !== predeterminadaOriginal) {
        const { res, json } = await pedir(`/api/admin/sucursales/${predeterminada}`, "PATCH", { predeterminada: true })
        if (!res.ok) nuevos.predeterminada = json?.error ?? "No pudimos guardar. Inténtelo nuevamente."
        else anotar(json)
      }

      // 2. Provincias de cada sucursal (zonas de venta).
      const plan = planZonas(zonasOriginales, zonas)
      for (const z of plan.guardar) {
        const { res, json } = await pedir("/api/admin/sucursales/zonas", "PUT", {
          provincia: z.provincia,
          sucursal: z.sucursal,
          facturaSucursal: z.facturaSucursal,
        })
        if (!res.ok) nuevos[`zona:${z.sucursal}`] = `${z.provincia}: ${json?.error ?? "No pudimos guardar."}`
        else anotar(json)
      }
      for (const clave of plan.quitar) {
        const { res, json } = await pedir(`/api/admin/sucursales/zonas/${clave}`, "DELETE")
        const sucursal = zonasOriginales.find((z) => z.provinciaClave === clave)?.sucursal ?? ""
        if (!res.ok && res.status !== 404) nuevos[`zona:${sucursal}`] = json?.error ?? "No pudimos quitar la provincia."
        else if (res.ok) anotar(json)
      }

      // 3. Envío a domicilio y ciudades. «A toda su zona» = lista vacía.
      for (const f of filas) {
        const ciudades = f.aceptaEnvio && f.modo === "todas" ? [] : f.ciudades
        if (f.aceptaEnvio === f.original.aceptaEnvio && mismasCiudades(ciudades, f.original.ciudades)) continue
        const { res, json } = await pedir(`/api/admin/sucursales/${f.slug}`, "PATCH", { aceptaEnvio: f.aceptaEnvio, envioCiudades: ciudades })
        if (!res.ok) nuevos[f.slug] = json?.error ?? "No pudimos guardar. Inténtelo nuevamente."
        else anotar(json)
      }

      // 4. Respaldo de stock.
      if (respaldo !== respaldoOriginal) {
        const { res, json } = await pedir("/api/admin/reglas-venta", "PUT", { respaldoEnvio: respaldo === "si" })
        if (!res.ok) nuevos.respaldoEnvio = json?.error ?? "No pudimos guardar. Inténtelo nuevamente."
        else anotar(json)
      }

      // Lo guardado manda: se recarga todo del servidor (el cambio de predeterminada toca dos filas).
      if (Object.keys(nuevos).length === 0) {
        const d = await cargarDatos()
        if (d) aplicar(d)
      }
    } catch {
      nuevos.general = "Error de conexión. Inténtelo nuevamente."
    } finally {
      setGuardando(false)
    }
    setErrores(nuevos)
    if (hubo && Object.keys(nuevos).length === 0) {
      if (propagadoTodo) toast({ title: "Zonas y envíos guardados", tone: "success" })
      else toast({ title: "Zonas y envíos guardados", description: "El Shop se actualizará en el próximo ciclo.", tone: "warning" })
    }
  }

  const libres = provinciasLibres(zonas)
  const opcionesFactura = [{ value: SIN_FACTURA, label: "La misma sucursal" }, ...activas.map((s) => ({ value: s.slug, label: s.nombre }))]

  return (
    <Card
      title="Zonas y envíos"
      description="Para cada sucursal, indique qué provincias atiende y si envía a domicilio. Rige para los pedidos nuevos; los pedidos ya creados conservan su sucursal."
    >
      {errorCarga && (
        <p className="text-sm" role="alert" style={ROJO}>
          No pudimos cargar las sucursales. Recargue la página.
        </p>
      )}
      {!filas && !errorCarga && (
        <p className="text-sm" style={SUAVE}>
          Cargando…
        </p>
      )}
      {filas && (
        <div className="flex flex-col gap-6">
          {errores.general && (
            <p className="text-sm" role="alert" style={ROJO}>
              {errores.general}
            </p>
          )}

          {filas.length === 0 && (
            <p className="text-sm" style={SUAVE}>
              Todavía no hay sucursales. Agréguelas en Sucursales.
            </p>
          )}

          {filas.map((f) => {
            const propias = zonas.filter((z) => z.sucursal === f.slug).sort((a, b) => a.provincia.localeCompare(b.provincia))
            const esPred = predeterminada === f.slug
            const opcionesAgregar = PROVINCIAS.filter((p) => !propias.some((z) => z.provinciaClave === claveProvincia(p))).map((p) => {
              const otra = zonas.find((z) => z.provinciaClave === claveProvincia(p))
              return { value: p, label: otra ? `${p} (hoy la atiende ${nombreDe(otra.sucursal)})` : p }
            })
            const resumen = resumenSucursal({
              activa: f.activa,
              predeterminada: esPred,
              provincias: propias.map((z) => z.provincia),
              aceptaEnvio: f.aceptaEnvio,
              ciudades: f.modo === "algunas" ? f.ciudades : [],
            })

            return (
              <section key={f.slug} className="flex flex-col gap-4 rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold" style={{ color: "var(--ink)" }}>
                    {f.nombre}
                  </h3>
                  {!f.activa && <Badge tone="neutral">Inactiva</Badge>}
                  {esPred && <Badge tone="info">Atiende las provincias sin asignar</Badge>}
                </div>

                <div className="flex flex-col gap-2">
                  <p className={TITULO} style={{ color: "var(--ink-faint)" }}>
                    1. Provincias que atiende
                  </p>
                  <p className="text-sm" style={SUAVE}>
                    Los pedidos con envío a estas provincias los prepara esta sucursal.
                  </p>
                  {propias.length === 0 && (
                    <p className="text-sm" style={SUAVE}>
                      {esPred ? "Ninguna en particular: atiende las provincias sin asignar." : "Ninguna."}
                    </p>
                  )}
                  {propias.length > 0 && (
                    <ul className="flex flex-col gap-2">
                      {propias.map((z) => (
                        <li key={z.provinciaClave} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="min-w-36 text-sm font-medium" style={{ color: "var(--ink)" }}>
                            {z.provincia}
                          </span>
                          <span className="text-sm" style={SUAVE}>
                            Factura:
                          </span>
                          <div className="min-w-44">
                            <Select
                              options={opcionesFactura}
                              value={z.facturaSucursal ?? SIN_FACTURA}
                              onValueChange={(v) => {
                                setZonas((zs) =>
                                  zs.map((x) => (x.provinciaClave === z.provinciaClave ? { ...x, facturaSucursal: v === SIN_FACTURA || v === f.slug ? null : v } : x)),
                                )
                                limpiarError(`zona:${f.slug}`)
                              }}
                              aria-label={`Sucursal que factura ${z.provincia}`}
                            />
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setZonas((zs) => zs.filter((x) => x.provinciaClave !== z.provinciaClave))
                              limpiarError(`zona:${f.slug}`)
                            }}
                          >
                            Quitar
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {f.activa && (
                    <div className="max-w-sm">
                      <Select
                        options={opcionesAgregar}
                        value=""
                        onValueChange={(p) => {
                          setZonas((zs) => asignarProvincia(zs, p, f.slug))
                          limpiarError(`zona:${f.slug}`)
                        }}
                        placeholder="Agregar provincia…"
                        aria-label={`Agregar provincia a ${f.nombre}`}
                      />
                    </div>
                  )}
                  {propias.some((z) => z.facturaSucursal) && (
                    <p className="text-xs" style={SUAVE}>
                      {HINT_SUCURSAL_QUE_FACTURA}
                    </p>
                  )}
                  {errores[`zona:${f.slug}`] && (
                    <p className="text-sm" role="alert" style={ROJO}>
                      {errores[`zona:${f.slug}`]}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  <p className={TITULO} style={{ color: "var(--ink-faint)" }}>
                    2. Envío a domicilio
                  </p>
                  <Switch
                    id={`envio-suc-${f.slug}`}
                    checked={f.aceptaEnvio}
                    onCheckedChange={(v) => cambiarFila(f.slug, { aceptaEnvio: v })}
                    label={f.aceptaEnvio ? "Envía a domicilio" : "No envía a domicilio"}
                  />
                  {f.aceptaEnvio && (
                    <>
                      <Field label="¿A dónde envía?">
                        <SegmentedControl
                          options={OPCIONES_CIUDADES}
                          value={f.modo}
                          onValueChange={(v) => cambiarFila(f.slug, { modo: v as ModoCiudades })}
                          ariaLabel={`A dónde envía ${f.nombre}`}
                        />
                      </Field>
                      {f.modo === "algunas" && (
                        <CiudadesEnvioSelector
                          label="Ciudades"
                          hint="Busque y agregue ciudades (no provincias). Fuera de estas ciudades, el cliente solo puede retirar en un local."
                          value={f.ciudades}
                          onChange={(ciudades) => cambiarFila(f.slug, { ciudades })}
                          error={errores[f.slug]}
                        />
                      )}
                    </>
                  )}
                  {(!f.aceptaEnvio || f.modo === "todas") && errores[f.slug] && (
                    <p className="text-sm" role="alert" style={ROJO}>
                      {errores[f.slug]}
                    </p>
                  )}
                </div>

                <p className="rounded-lg bg-subtle px-3 py-2 text-sm" style={{ color: "var(--ink)" }}>
                  {resumen}
                </p>
              </section>
            )
          })}

          {filas.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className={TITULO} style={{ color: "var(--ink-faint)" }}>
                Provincias sin asignar
              </h3>
              <Field
                label="Las atiende"
                hint={
                  libres.length === 0
                    ? "Hoy todas las provincias tienen una sucursal asignada."
                    : `Hoy son ${libres.length}: ${enumerar(libres)}.`
                }
                error={errores.predeterminada}
              >
                <div className="max-w-sm">
                  <Select
                    options={activas.map((s) => ({ value: s.slug, label: s.nombre }))}
                    value={predeterminada}
                    onValueChange={(v) => {
                      setPredeterminada(v)
                      limpiarError("predeterminada")
                    }}
                    placeholder="Seleccione una sucursal"
                    aria-label="Sucursal que atiende las provincias sin asignar"
                  />
                </div>
              </Field>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h3 className={TITULO} style={{ color: "var(--ink-faint)" }}>
              Respaldo
            </h3>
            <RadioGroup
              legend="Si la sucursal de la zona no tiene stock"
              options={OPCIONES_RESPALDO}
              value={respaldo}
              onValueChange={(v) => {
                setRespaldo(v as "si" | "no")
                limpiarError("respaldoEnvio")
              }}
            />
            {errores.respaldoEnvio && (
              <p className="text-sm" role="alert" style={ROJO}>
                {errores.respaldoEnvio}
              </p>
            )}
          </section>

          <div>
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar zonas y envíos"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
