"use client"

import { useEffect, useState } from "react"
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, SegmentedControl, Table, useToast } from "@myd-org/ui"
import type { CuentaBancariaDto } from "@/lib/cuentas-bancarias-shop-repo"
import { resumenMonto, resumenSucursales } from "@/lib/cuentas-bancarias-shop-resumen"
import { validarCuentaBancaria } from "@/lib/cuentas-bancarias-shop-validacion"

// Pagos y cuotas: cuentas bancarias a las que el Shop pide transferir. Cada cuenta declara a qué
// pedidos aplica (todas las sucursales o las elegidas, y un rango de monto); el Shop usa la de
// menor orden que cumple y, si ninguna cumple, la predeterminada. Cada guardado avisa al Shop
// (best-effort): si el aviso no llegó, el cambio igual quedó guardado y la tienda lo toma en su
// próximo ciclo. Los pedidos ya creados conservan la cuenta que se les mostró.

type Errores = Record<string, string>
type SucursalOpcion = { slug: string; nombre: string; activa: boolean }

type Form = {
  editandoId: string | null
  alias: string
  cbu: string
  banco: string
  titular: string
  cuit: string
  todas: boolean
  sucursalSlugs: string[]
  montoMin: string
  montoMax: string
  orden: string
  activa: boolean
  predeterminada: boolean
}

// El alta arranca en "Todas las sucursales": es la elección explícita más común.
const formVacio = (orden: number): Form => ({
  editandoId: null,
  alias: "",
  cbu: "",
  banco: "",
  titular: "",
  cuit: "",
  todas: true,
  sucursalSlugs: [],
  montoMin: "",
  montoMax: "",
  orden: String(orden),
  activa: true,
  predeterminada: false,
})

const montoATexto = (n: number | null) => (n === null ? "" : String(n).replace(".", ","))

const desdeDto = (c: CuentaBancariaDto): Form => ({
  editandoId: c.id,
  alias: c.alias,
  cbu: c.cbu,
  banco: c.banco,
  titular: c.titular,
  cuit: c.cuit,
  todas: c.todasLasSucursales,
  sucursalSlugs: c.sucursalSlugs,
  montoMin: montoATexto(c.montoMin),
  montoMax: montoATexto(c.montoMax),
  orden: String(c.orden),
  activa: c.activa,
  predeterminada: c.predeterminada,
})

const cuerpo = (f: Form) => ({
  alias: f.alias,
  cbu: f.cbu,
  banco: f.banco,
  titular: f.titular,
  cuit: f.cuit,
  todasLasSucursales: f.todas,
  sucursalSlugs: f.todas ? [] : f.sucursalSlugs,
  montoMin: f.montoMin,
  montoMax: f.montoMax,
  orden: f.orden,
  activa: f.activa,
  predeterminada: f.predeterminada,
})

const porOrden = (a: CuentaBancariaDto, b: CuentaBancariaDto) => a.orden - b.orden || a.alias.localeCompare(b.alias)

async function enviar(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  })
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
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

export function CuentasBancariasShopCard() {
  const [cuentas, setCuentas] = useState<CuentaBancariaDto[] | null>(null)
  const [sucursales, setSucursales] = useState<SucursalOpcion[]>([])
  const [errorCarga, setErrorCarga] = useState(false)
  const [form, setForm] = useState<Form | null>(null)
  const [borrar, setBorrar] = useState<CuentaBancariaDto | null>(null)
  const [errores, setErrores] = useState<Errores>({})
  const [guardando, setGuardando] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    let vivo = true
    Promise.all([enviar("/api/admin/cuentas-bancarias-shop", "GET"), enviar("/api/admin/sucursales", "GET")])
      .then(([c, s]) => {
        if (!vivo) return
        if (!c.res.ok || !c.json?.cuentas) setErrorCarga(true)
        else setCuentas((c.json.cuentas as CuentaBancariaDto[]).slice().sort(porOrden))
        if (s.res.ok && Array.isArray(s.json?.sucursales)) setSucursales(s.json.sucursales as SucursalOpcion[])
      })
      .catch(() => vivo && setErrorCarga(true))
    return () => {
      vivo = false
    }
  }, [])

  const avisar = (titulo: string, propagado: unknown) => {
    if (propagado === true) toast({ title: titulo, tone: "success" })
    else toast({ title: titulo, description: "El Shop se actualizará en el próximo ciclo.", tone: "warning" })
  }

  const cambiar = (parcial: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...parcial } : f))
    setErrores({})
  }

  function manejarError(status: number, json: Record<string, unknown> | null) {
    const mensaje = typeof json?.error === "string" ? json.error : undefined
    if (status === 404) setErrores({ general: "No encontramos ese registro. Recargue la página." })
    else if ((status === 400 || status === 409) && mensaje) {
      const campo = typeof json?.campo === "string" && json.campo !== "body" ? json.campo : "general"
      setErrores({ [campo]: mensaje })
    } else setErrores({ general: mensaje ?? "No pudimos guardar. Inténtelo nuevamente." })
  }

  async function guardar() {
    if (!form) return
    setErrores({})
    const c = cuerpo(form)
    const v = validarCuentaBancaria(c)
    if (!v.ok) return setErrores({ [v.campo === "body" ? "general" : v.campo]: v.error })

    setGuardando(true)
    try {
      const { res, json } = form.editandoId
        ? await enviar(`/api/admin/cuentas-bancarias-shop/${form.editandoId}`, "PATCH", c)
        : await enviar("/api/admin/cuentas-bancarias-shop", "POST", c)
      if (!res.ok || !json) return manejarError(res.status, json)
      const nueva = json.cuenta as CuentaBancariaDto
      setCuentas((prev) => {
        const resto = (prev ?? []).filter((x) => x.id !== nueva.id)
        // Una sola predeterminada: si esta lo es, las demás dejan de serlo.
        const ajustadas = nueva.predeterminada ? resto.map((x) => ({ ...x, predeterminada: false })) : resto
        return [...ajustadas, nueva].sort(porOrden)
      })
      setForm(null)
      avisar(form.editandoId ? "Cuenta actualizada" : "Cuenta agregada", json.propagado)
    } catch {
      setErrores({ general: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      setGuardando(false)
    }
  }

  async function alternarActiva(c: CuentaBancariaDto) {
    try {
      const { res, json } = await enviar(`/api/admin/cuentas-bancarias-shop/${c.id}`, "PATCH", { activa: !c.activa })
      if (!res.ok || !json) {
        toast({ title: typeof json?.error === "string" ? json.error : "No pudimos actualizar la cuenta.", tone: "danger" })
        return
      }
      const nueva = json.cuenta as CuentaBancariaDto
      setCuentas((prev) => (prev ?? []).map((x) => (x.id === nueva.id ? nueva : x)))
      avisar(nueva.activa ? "Cuenta activada" : "Cuenta desactivada", json.propagado)
    } catch {
      toast({ title: "Error de conexión. Inténtelo nuevamente.", tone: "danger" })
    }
  }

  async function confirmarBorrar() {
    if (!borrar) return
    setGuardando(true)
    try {
      const { res, json } = await enviar(`/api/admin/cuentas-bancarias-shop/${borrar.id}`, "DELETE")
      if (!res.ok) {
        toast({ title: typeof json?.error === "string" ? json.error : "No pudimos eliminar la cuenta.", tone: "danger" })
        setBorrar(null)
        return
      }
      setCuentas((prev) => (prev ?? []).filter((x) => x.id !== borrar.id))
      setBorrar(null)
      avisar("Cuenta eliminada", json?.propagado)
    } catch {
      toast({ title: "Error de conexión. Inténtelo nuevamente.", tone: "danger" })
    } finally {
      setGuardando(false)
    }
  }

  const alternarSucursal = (slug: string, marcada: boolean) => {
    if (!form) return
    const sin = form.sucursalSlugs.filter((s) => s !== slug)
    cambiar({ sucursalSlugs: marcada ? [...sin, slug] : sin })
  }

  // Un slug guardado cuya sucursal ya no existe se sigue mostrando para poder quitarlo.
  const opcionesSucursal: SucursalOpcion[] = [
    ...sucursales,
    ...(form?.sucursalSlugs ?? []).filter((s) => !sucursales.some((x) => x.slug === s)).map((slug) => ({ slug, nombre: slug, activa: false })),
  ]

  return (
    <Card
      title="Cuentas bancarias para transferencias"
      description="Son las cuentas que el cliente ve al elegir transferencia. Para cada pedido se usa la cuenta de menor orden que cumpla la sucursal y el monto; si ninguna cumple, se usa la predeterminada. Los cambios rigen para los pedidos nuevos: los ya creados conservan la cuenta que se les mostró."
    >
      {errorCarga && (
        <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
          No pudimos cargar las cuentas bancarias. Recargue la página.
        </p>
      )}
      {!cuentas && !errorCarga && (
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Cargando…
        </p>
      )}
      {cuentas && (
        <div className="flex flex-col gap-3">
          <Table<CuentaBancariaDto>
            rows={cuentas}
            rowKey={(c) => c.id}
            empty={
              <p className="text-sm py-4" style={{ color: "var(--ink-soft)" }}>
                Todavía no hay cuentas bancarias. Agregue la primera.
              </p>
            }
            columns={[
              {
                key: "cuenta",
                header: "Cuenta",
                render: (c) => (
                  <div className="flex flex-col">
                    <span>{c.alias}</span>
                    <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                      {[c.banco, c.titular].filter(Boolean).join(" · ") || "Sin banco ni titular"}
                    </span>
                    <span className="text-xs" style={{ color: "var(--ink-soft)" }}>CBU {c.cbu}</span>
                  </div>
                ),
              },
              {
                key: "reglas",
                header: "Se usa para",
                render: (c) => (
                  <div className="flex flex-col text-sm">
                    <span>{resumenSucursales(c)}</span>
                    <span>{resumenMonto(c)}</span>
                  </div>
                ),
                hideBelow: "sm",
              },
              { key: "orden", header: "Orden", render: (c) => c.orden, hideBelow: "sm" },
              {
                key: "estado",
                header: "Estado",
                render: (c) => (
                  <div className="flex gap-1 flex-wrap">
                    <Badge tone={c.activa ? "success" : "neutral"}>{c.activa ? "Activa" : "Inactiva"}</Badge>
                    {c.predeterminada && <Badge tone="info">Predeterminada</Badge>}
                  </div>
                ),
              },
              {
                key: "acciones",
                header: "",
                align: "right",
                render: (c) => (
                  <div className="flex gap-1 justify-end flex-wrap">
                    <Button size="sm" variant="ghost" onClick={() => { setErrores({}); setForm(desdeDto(c)) }}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void alternarActiva(c)}>
                      {c.activa ? "Desactivar" : "Activar"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setBorrar(c)}>
                      Eliminar
                    </Button>
                  </div>
                ),
              },
            ]}
          />
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                setErrores({})
                setForm(formVacio((cuentas ?? []).reduce((max, c) => Math.max(max, c.orden), -1) + 1))
              }}
            >
              Agregar cuenta
            </Button>
          </div>
        </div>
      )}

      <Dialog
        dismissible={false}
        open={form !== null}
        onOpenChange={(open) => {
          if (!open) setForm(null)
        }}
        title={form?.editandoId ? "Editar cuenta bancaria" : "Agregar cuenta bancaria"}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
            <Button loading={guardando} disabled={guardando} onClick={() => void guardar()}>Guardar</Button>
          </div>
        }
      >
        {form && (
          <div className="flex flex-col gap-3">
            <Field label="Alias" hint="Es el alias de la cuenta que ve el cliente." error={errores.alias}>
              <Input value={form.alias} onChange={(e) => cambiar({ alias: e.target.value })} aria-invalid={Boolean(errores.alias)} />
            </Field>
            <Field label="CBU" hint="22 dígitos." error={errores.cbu}>
              <Input inputMode="numeric" value={form.cbu} onChange={(e) => cambiar({ cbu: e.target.value })} aria-invalid={Boolean(errores.cbu)} />
            </Field>
            <Field label="Banco" error={errores.banco}>
              <Input value={form.banco} onChange={(e) => cambiar({ banco: e.target.value })} aria-invalid={Boolean(errores.banco)} />
            </Field>
            <Field label="Titular" error={errores.titular}>
              <Input value={form.titular} onChange={(e) => cambiar({ titular: e.target.value })} aria-invalid={Boolean(errores.titular)} />
            </Field>
            <Field label="CUIT" hint="11 dígitos. Es opcional." error={errores.cuit}>
              <Input inputMode="numeric" value={form.cuit} onChange={(e) => cambiar({ cuit: e.target.value })} aria-invalid={Boolean(errores.cuit)} />
            </Field>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>Sucursales</span>
              <SegmentedControl
                ariaLabel="Sucursales a las que aplica la cuenta"
                value={form.todas ? "todas" : "elegir"}
                onValueChange={(v) => cambiar({ todas: v === "todas" })}
                options={[
                  { value: "todas", label: "Todas las sucursales" },
                  { value: "elegir", label: "Elegir sucursales" },
                ]}
              />
              {!form.todas && (
                <div className="flex flex-col gap-2 pl-1">
                  {opcionesSucursal.length === 0 && (
                    <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                      Todavía no hay sucursales cargadas.
                    </p>
                  )}
                  {opcionesSucursal.map((s) => (
                    <CheckboxLabel
                      key={s.slug}
                      id={`cuenta-suc-${s.slug}`}
                      checked={form.sucursalSlugs.includes(s.slug)}
                      onChange={(v) => alternarSucursal(s.slug, v)}
                      label={s.activa ? s.nombre : `${s.nombre} (inactiva)`}
                    />
                  ))}
                </div>
              )}
              {errores.sucursalSlugs && <p className="text-sm" style={{ color: "var(--red)" }}>{errores.sucursalSlugs}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Monto mínimo" hint="Vacío = sin mínimo. Incluye impuestos." error={errores.montoMin}>
                <Input inputMode="decimal" value={form.montoMin} onChange={(e) => cambiar({ montoMin: e.target.value })} aria-invalid={Boolean(errores.montoMin)} />
              </Field>
              <Field label="Monto máximo" hint="Vacío = sin máximo." error={errores.montoMax}>
                <Input inputMode="decimal" value={form.montoMax} onChange={(e) => cambiar({ montoMax: e.target.value })} aria-invalid={Boolean(errores.montoMax)} />
              </Field>
            </div>

            <Field label="Orden" hint="Entre las cuentas que cumplen las reglas se usa la de menor número." error={errores.orden}>
              <Input inputMode="numeric" value={form.orden} onChange={(e) => cambiar({ orden: e.target.value })} aria-invalid={Boolean(errores.orden)} />
            </Field>

            <div className="flex flex-col gap-2">
              <CheckboxLabel id="cuenta-activa" checked={form.activa} onChange={(v) => cambiar({ activa: v })} label="Activa" hint="Una cuenta inactiva no se ofrece a los clientes." />
              {errores.activa && <p className="text-sm" style={{ color: "var(--red)" }}>{errores.activa}</p>}
              <CheckboxLabel
                id="cuenta-predeterminada"
                checked={form.predeterminada}
                onChange={(v) => cambiar({ predeterminada: v })}
                label="Cuenta predeterminada"
                hint="Se usa cuando ninguna otra cuenta cumple las reglas. Solo una cuenta puede serlo: al marcar esta, la anterior deja de serlo."
              />
              {errores.predeterminada && <p className="text-sm" style={{ color: "var(--red)" }}>{errores.predeterminada}</p>}
            </div>
            {errores.general && <p className="text-sm" style={{ color: "var(--red)" }}>{errores.general}</p>}
          </div>
        )}
      </Dialog>

      <Dialog
        open={borrar !== null}
        onOpenChange={(open) => {
          if (!open) setBorrar(null)
        }}
        title="Eliminar cuenta bancaria"
        description="Se elimina definitivamente. Los pedidos ya creados conservan los datos de la cuenta que se les mostró."
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setBorrar(null)}>Cancelar</Button>
            <Button variant="danger" loading={guardando} onClick={() => void confirmarBorrar()}>Eliminar</Button>
          </div>
        }
      >
        {borrar && <p className="text-sm" style={{ color: "var(--ink)" }}>¿Eliminar la cuenta &quot;{borrar.alias}&quot;?</p>}
      </Dialog>
    </Card>
  )
}
