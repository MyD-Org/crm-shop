"use client"

import { useEffect, useState } from "react"
import { Button, Card, Field, Select, Switch, useToast } from "@myd-org/ui"
import type { SucursalDto } from "@/lib/sucursales-repo"
import type { ReglasVenta } from "@/lib/reglas-venta-validacion"
import { CiudadesEnvioSelector } from "@/components/admin/CiudadesEnvioSelector"

// Envíos: "Desde dónde sale el envío". Por sucursal, si realiza envíos y a qué ciudades; y si el
// pedido puede despacharse desde otra sucursal cuando la de la zona no tiene stock. Usa las APIs
// de Sucursales (PATCH parcial) y de Reglas de venta (PUT parcial). Cada guardado avisa al Shop
// (best-effort): si el aviso no llegó, el cambio igual quedó guardado.

type FilaForm = { slug: string; nombre: string; activa: boolean; aceptaEnvio: boolean; ciudades: string[]; original: string[]; originalEnvio: boolean }
type Errores = Record<string, string>

const OPCIONES_RESPALDO = [
  { value: "si", label: "Sí, despachar desde otra sucursal" },
  { value: "no", label: "No, informar que no hay stock" },
]

const TITULO_SECCION = "text-xs font-semibold uppercase tracking-wider"

const mismasCiudades = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i])

const aFila = (s: SucursalDto): FilaForm => ({
  slug: s.slug,
  nombre: s.nombre,
  activa: s.activa,
  aceptaEnvio: s.aceptaEnvio,
  ciudades: [...s.envioCiudades],
  original: [...s.envioCiudades],
  originalEnvio: s.aceptaEnvio,
})

export function EnviosSucursalesCard() {
  const [filas, setFilas] = useState<FilaForm[] | null>(null)
  const [respaldo, setRespaldo] = useState<"si" | "no">("si")
  const [respaldoOriginal, setRespaldoOriginal] = useState<"si" | "no">("si")
  const [errores, setErrores] = useState<Errores>({})
  const [guardando, setGuardando] = useState(false)
  const [errorCarga, setErrorCarga] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    let vivo = true
    Promise.all([
      fetch("/api/admin/sucursales", { cache: "no-store" }).then(async (res) => ({ res, json: (await res.json().catch(() => null)) as { sucursales?: SucursalDto[] } | null })),
      fetch("/api/admin/reglas-venta", { cache: "no-store" }).then(async (res) => ({ res, json: (await res.json().catch(() => null)) as { reglas?: ReglasVenta } | null })),
    ])
      .then(([suc, reg]) => {
        if (!vivo) return
        if (!suc.res.ok || !suc.json?.sucursales || !reg.res.ok || !reg.json?.reglas) {
          setErrorCarga(true)
          return
        }
        setFilas(suc.json.sucursales.slice().sort((a, b) => a.orden - b.orden).map(aFila))
        const r = reg.json.reglas.respaldoEnvio ? "si" : "no"
        setRespaldo(r)
        setRespaldoOriginal(r)
      })
      .catch(() => vivo && setErrorCarga(true))
    return () => {
      vivo = false
    }
  }, [])

  const cambiarFila = (slug: string, cambios: Partial<FilaForm>) => {
    setFilas((fs) => (fs ? fs.map((f) => (f.slug === slug ? { ...f, ...cambios } : f)) : fs))
    setErrores((e) => ({ ...e, [slug]: "", general: "" }))
  }

  async function guardar() {
    if (!filas) return
    setGuardando(true)
    setErrores({})
    const nuevosErrores: Errores = {}
    let propagadoTodo = true
    let hubo = false
    try {
      for (const f of filas) {
        if (f.aceptaEnvio === f.originalEnvio && mismasCiudades(f.ciudades, f.original)) continue
        const res = await fetch(`/api/admin/sucursales/${f.slug}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ aceptaEnvio: f.aceptaEnvio, envioCiudades: f.ciudades }),
        })
        const json = (await res.json().catch(() => null)) as { error?: string; propagado?: boolean; sucursal?: SucursalDto } | null
        if (!res.ok || !json?.sucursal) {
          nuevosErrores[f.slug] = json?.error ?? "No pudimos guardar. Inténtelo nuevamente."
          continue
        }
        hubo = true
        if (json.propagado !== true) propagadoTodo = false
        const guardada = aFila(json.sucursal)
        setFilas((fs) => (fs ? fs.map((x) => (x.slug === f.slug ? { ...x, ...guardada, activa: x.activa } : x)) : fs))
      }

      if (respaldo !== respaldoOriginal) {
        const res = await fetch("/api/admin/reglas-venta", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ respaldoEnvio: respaldo === "si" }),
        })
        const json = (await res.json().catch(() => null)) as { error?: string; propagado?: boolean; reglas?: ReglasVenta } | null
        if (!res.ok || !json?.reglas) nuevosErrores.respaldoEnvio = json?.error ?? "No pudimos guardar. Inténtelo nuevamente."
        else {
          hubo = true
          if (json.propagado !== true) propagadoTodo = false
          const r = json.reglas.respaldoEnvio ? "si" : "no"
          setRespaldo(r)
          setRespaldoOriginal(r)
        }
      }
    } catch {
      nuevosErrores.general = "Error de conexión. Inténtelo nuevamente."
    } finally {
      setGuardando(false)
    }
    setErrores(nuevosErrores)
    if (hubo && Object.keys(nuevosErrores).length === 0) {
      if (propagadoTodo) toast({ title: "Envíos por sucursal guardados", tone: "success" })
      else toast({ title: "Envíos por sucursal guardados", description: "El Shop se actualizará en el próximo ciclo.", tone: "warning" })
    }
  }

  return (
    <Card
      title="Desde dónde sale el envío"
      description="Indique qué sucursales realizan envíos y a qué ciudades. Rige para los pedidos nuevos; los pedidos ya creados conservan su sucursal."
    >
      {errorCarga && (
        <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
          No pudimos cargar las sucursales. Recargue la página.
        </p>
      )}
      {!filas && !errorCarga && (
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Cargando…
        </p>
      )}
      {filas && (
        <div className="flex flex-col gap-5">
          {errores.general && (
            <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
              {errores.general}
            </p>
          )}

          {filas.length === 0 && (
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              Todavía no hay sucursales. Agréguelas en Sucursales.
            </p>
          )}

          {filas.map((f) => (
            <section key={f.slug} className="flex flex-col gap-3">
              <h3 className={TITULO_SECCION} style={{ color: "var(--ink-faint)" }}>
                {f.nombre}
                {!f.activa && " (inactiva)"}
              </h3>
              <Switch
                id={`envio-suc-${f.slug}`}
                checked={f.aceptaEnvio}
                onCheckedChange={(v) => cambiarFila(f.slug, { aceptaEnvio: v })}
                label={f.aceptaEnvio ? "Realiza envíos" : "No realiza envíos"}
              />
              {f.aceptaEnvio && (
                <CiudadesEnvioSelector
                  value={f.ciudades}
                  onChange={(ciudades) => cambiarFila(f.slug, { ciudades })}
                  error={errores[f.slug]}
                />
              )}
              {!f.aceptaEnvio && errores[f.slug] && (
                <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
                  {errores[f.slug]}
                </p>
              )}
            </section>
          ))}

          <section className="flex flex-col gap-3">
            <h3 className={TITULO_SECCION} style={{ color: "var(--ink-faint)" }}>
              Respaldo
            </h3>
            <Field
              label="Envío con respaldo de otra sucursal"
              hint="Si la sucursal de la zona del cliente no tiene stock, el pedido se despacha desde otra sucursal con stock."
              error={errores.respaldoEnvio}
            >
              <Select
                options={OPCIONES_RESPALDO}
                value={respaldo}
                onValueChange={(v) => {
                  setRespaldo(v as "si" | "no")
                  setErrores((e) => ({ ...e, respaldoEnvio: "" }))
                }}
              />
            </Field>
          </section>

          <div>
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar origen del envío"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
