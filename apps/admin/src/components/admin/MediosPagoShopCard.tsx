"use client"

import { useEffect, useState } from "react"
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, Select, Switch, Table, Textarea, useToast } from "@myd-org/ui"
import type { MedioPagoConAvisos } from "@/lib/medios-pago-shop-repo"
import { LISTA_POR_DEFECTO, aplicarMedioGuardado, cuerpoDePrecios } from "@/lib/medios-pago-shop-form"
import { normalizarIdentificador } from "@/lib/identificador"
import { SLUG_MERCADOPAGO, validarMedioPagoCambios, validarMedioPagoNuevo } from "@/lib/medios-pago-shop-validacion"

// Configuración → Sucursales y ventas: medios de pago que el checkout del Shop ofrece. Cada
// guardado avisa al Shop (best-effort): si el aviso no llegó, el cambio igual quedó guardado y la
// tienda lo toma en su próximo ciclo. El identificador (slug) es lo que queda en el pedido: no
// se puede cambiar, y un medio ya usado se desactiva en lugar de eliminarse.

type Errores = Record<string, string>

type Form = {
  editandoSlug: string | null
  slug: string
  nombre: string
  instrucciones: string
  aplicaRetiro: boolean
  aplicaEnvio: boolean
  activo: boolean
  listaOnlineId: string
  destacarEnCatalogo: boolean
  mostrarEnFicha: boolean
}

type Lista = { id: string; nombre: string }
type MedioPagoDto = MedioPagoConAvisos

const formVacio: Form = {
  editandoSlug: null,
  slug: "",
  nombre: "",
  instrucciones: "",
  aplicaRetiro: true,
  aplicaEnvio: true,
  activo: true,
  listaOnlineId: LISTA_POR_DEFECTO,
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
}

const desdeDto = (m: MedioPagoDto): Form => ({
  editandoSlug: m.slug,
  slug: m.slug,
  nombre: m.nombre,
  instrucciones: m.instrucciones,
  aplicaRetiro: m.aplicaRetiro,
  aplicaEnvio: m.aplicaEnvio,
  activo: m.activo,
  listaOnlineId: m.listaOnlineId ?? LISTA_POR_DEFECTO,
  destacarEnCatalogo: m.destacarEnCatalogo,
  mostrarEnFicha: m.mostrarEnFicha,
})

// El destacado y la ficha se configuran sólo editando un medio ya creado; la lista se enlaza aparte
// (Precios online: vista previa, aplicar e historial).
const cuerpo = (f: Form) => ({
  ...(f.editandoSlug ? { ...cuerpoDePrecios(f) } : { slug: f.slug }),
  nombre: f.nombre,
  instrucciones: f.instrucciones,
  aplicaRetiro: f.aplicaRetiro,
  aplicaEnvio: f.aplicaEnvio,
  activo: f.activo,
})

const porOrden = (a: MedioPagoDto, b: MedioPagoDto) => a.orden - b.orden || a.nombre.localeCompare(b.nombre)

/** Nombre a mostrar de la lista enlazada (sin enlace rige la lista de referencia). */
const nombreDeLista = (m: MedioPagoDto) => m.listaOnlineNombre

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

function CheckboxLabel(props: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={props.id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--ink)" }}>
        <Checkbox id={props.id} checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChange} />
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

export function MediosPagoShopCard() {
  const [medios, setMedios] = useState<MedioPagoDto[] | null>(null)
  const [listas, setListas] = useState<Lista[]>([])
  const [errorCarga, setErrorCarga] = useState(false)
  const [form, setForm] = useState<Form | null>(null)
  const [borrar, setBorrar] = useState<MedioPagoDto | null>(null)
  const [errores, setErrores] = useState<Errores>({})
  const [guardando, setGuardando] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    let vivo = true
    enviar("/api/admin/medios-pago-shop", "GET")
      .then(({ res, json }) => {
        if (!vivo) return
        if (!res.ok || !json?.medios) setErrorCarga(true)
        else {
          setMedios((json.medios as MedioPagoDto[]).slice().sort(porOrden))
          setListas(Array.isArray(json.listas) ? (json.listas as Lista[]) : [])
        }
      })
      .catch(() => vivo && setErrorCarga(true))
    return () => {
      vivo = false
    }
  }, [])

  /**
   * Enlaza (o desenlaza con null) la lista de precio online del medio por el camino de cualquier
   * cambio de precios: vista previa, aplicar y entrada en el historial. Devuelve el error, si hay.
   */
  async function enlazarLista(slug: string, listaId: string | null): Promise<string | null> {
    const cambios = [{ op: "setCondicion", medioSlug: slug, cuotas: null, listaId }]
    const previa = await enviar("/api/admin/precios-online/previsualizar", "POST", { cambios })
    if (!previa.res.ok || !previa.json?.previa) {
      return typeof previa.json?.error === "string" ? previa.json.error : "No pudimos enlazar la lista de precios."
    }
    const { baseVersion, huella } = previa.json.previa as { baseVersion: number; huella: string }
    const r = await enviar("/api/admin/precios-online/aplicar", "POST", { cambios, baseVersion, huella })
    if (!r.res.ok) return typeof r.json?.error === "string" ? r.json.error : "No pudimos enlazar la lista de precios."
    return null
  }

  /** Recarga los avisos tras un cambio que puede afectarlos (otro medio dejó de estar destacado). */
  async function recargarAvisos() {
    try {
      const { res, json } = await enviar("/api/admin/medios-pago-shop", "GET")
      if (res.ok && json?.medios) setMedios((json.medios as MedioPagoDto[]).slice().sort(porOrden))
    } catch {
      // Los avisos son informativos: si la recarga falla se conservan los que hay.
    }
  }

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
    const v = form.editandoSlug ? validarMedioPagoCambios(c) : validarMedioPagoNuevo(c)
    if (!v.ok) return setErrores({ [v.campo === "body" ? "general" : v.campo]: v.error })

    setGuardando(true)
    try {
      const { res, json } = form.editandoSlug
        ? await enviar(`/api/admin/medios-pago-shop/${form.editandoSlug}`, "PATCH", c)
        : await enviar("/api/admin/medios-pago-shop", "POST", {
            ...c,
            // El alta va al final de la lista.
            orden: (medios ?? []).reduce((max, m) => Math.max(max, m.orden), -1) + 1,
          })
      if (!res.ok || !json) return manejarError(res.status, json)
      const nuevo = json.medio as MedioPagoDto
      setMedios((prev) => aplicarMedioGuardado(prev ?? [], nuevo))
      const listaElegida = form.listaOnlineId === LISTA_POR_DEFECTO ? null : form.listaOnlineId
      const cambioLista = form.editandoSlug !== null && listaElegida !== nuevo.listaOnlineId
      if (cambioLista) {
        const falla = await enlazarLista(nuevo.slug, listaElegida)
        if (falla) {
          setErrores({ listaOnlineId: `Los datos del medio se guardaron, pero no se pudo cambiar la lista. ${falla}` })
          void recargarAvisos()
          return
        }
      }
      setForm(null)
      if (nuevo.destacarEnCatalogo || cambioLista) void recargarAvisos()
      avisar(form.editandoSlug ? "Medio de pago actualizado" : "Medio de pago agregado", json.propagado)
    } catch {
      setErrores({ general: "Error de conexión. Inténtelo nuevamente." })
    } finally {
      setGuardando(false)
    }
  }

  async function alternarActivo(m: MedioPagoDto) {
    try {
      const { res, json } = await enviar(`/api/admin/medios-pago-shop/${m.slug}`, "PATCH", { activo: !m.activo })
      if (!res.ok || !json) {
        toast({ title: typeof json?.error === "string" ? json.error : "No pudimos actualizar el medio de pago.", tone: "danger" })
        return
      }
      const nuevo = json.medio as MedioPagoDto
      setMedios((prev) => (prev ?? []).map((x) => (x.slug === nuevo.slug ? nuevo : x)))
      avisar(nuevo.activo ? "Medio de pago activado" : "Medio de pago desactivado", json.propagado)
    } catch {
      toast({ title: "Error de conexión. Inténtelo nuevamente.", tone: "danger" })
    }
  }

  /** Mueve un medio una posición y renumera `orden` (0..n-1) sólo donde cambió. */
  async function mover(slug: string, delta: -1 | 1) {
    if (!medios) return
    const lista = medios.slice()
    const i = lista.findIndex((m) => m.slug === slug)
    const j = i + delta
    if (i < 0 || j < 0 || j >= lista.length) return
    ;[lista[i], lista[j]] = [lista[j], lista[i]]
    const renumerada = lista.map((m, idx) => ({ ...m, orden: idx }))
    setGuardando(true)
    try {
      let propagado: unknown = true
      for (const m of renumerada) {
        const antes = medios.find((x) => x.slug === m.slug)
        if (antes && antes.orden === m.orden) continue
        const { res, json } = await enviar(`/api/admin/medios-pago-shop/${m.slug}`, "PATCH", { orden: m.orden })
        if (!res.ok) {
          toast({ title: typeof json?.error === "string" ? json.error : "No pudimos reordenar los medios de pago.", tone: "danger" })
          return
        }
        if (json?.propagado !== true) propagado = false
      }
      setMedios(renumerada)
      avisar("Orden actualizado", propagado)
    } catch {
      toast({ title: "Error de conexión. Inténtelo nuevamente.", tone: "danger" })
    } finally {
      setGuardando(false)
    }
  }

  async function confirmarBorrar() {
    if (!borrar) return
    setGuardando(true)
    try {
      const { res, json } = await enviar(`/api/admin/medios-pago-shop/${borrar.slug}`, "DELETE")
      if (!res.ok) {
        toast({ title: typeof json?.error === "string" ? json.error : "No pudimos eliminar el medio de pago.", tone: "danger" })
        setBorrar(null)
        return
      }
      setMedios((prev) => (prev ?? []).filter((m) => m.slug !== borrar.slug))
      setBorrar(null)
      avisar("Medio de pago eliminado", json?.propagado)
    } catch {
      toast({ title: "Error de conexión. Inténtelo nuevamente.", tone: "danger" })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Card
      title="Medios de pago del checkout"
      description="Son los medios que el cliente puede elegir al finalizar la compra. El pago se coordina con el cliente después: acá se define qué se le ofrece y qué instrucciones ve. Los cambios rigen para los pedidos nuevos."
    >
      {errorCarga && (
        <p className="text-sm" role="alert" style={{ color: "var(--red)" }}>
          No pudimos cargar los medios de pago. Recargue la página.
        </p>
      )}
      {!medios && !errorCarga && (
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Cargando…
        </p>
      )}
      {medios && (
        <div className="flex flex-col gap-3">
          <Table<MedioPagoDto>
            rows={medios}
            rowKey={(m) => m.slug}
            empty={
              <p className="text-sm py-4" style={{ color: "var(--ink-soft)" }}>
                Todavía no hay medios de pago. Agregue el primero.
              </p>
            }
            columns={[
              {
                key: "nombre",
                header: "Medio de pago",
                render: (m) => (
                  <div className="flex flex-col">
                    <span>{m.nombre}</span>
                    <span className="text-xs" style={{ color: "var(--ink-soft)" }}>{m.slug}</span>
                    {m.slug === SLUG_MERCADOPAGO && (
                      <span className="text-xs" role="note" style={{ color: "var(--ink-soft)" }}>
                        Mercado Pago solo se ofrece si las credenciales están cargadas en la tienda.
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: "precios",
                header: "Precio",
                render: (m) => {
                  const lista = nombreDeLista(m)
                  return (
                    <div className="flex flex-col gap-0.5">
                      <span>{lista ?? "Lista de referencia"}</span>
                      {m.destacarEnCatalogo && <Badge tone="info">Destacado en catálogo</Badge>}
                      {m.mostrarEnFicha && <span className="text-xs" style={{ color: "var(--ink-soft)" }}>Se muestra en la ficha</span>}
                      {m.avisos.map((a) => (
                        <span key={a} className="text-xs" role="note" style={{ color: "var(--amber, var(--ink-soft))" }}>
                          {a}
                        </span>
                      ))}
                    </div>
                  )
                },
                hideBelow: "sm",
              },
              {
                key: "aplica",
                header: "Aplica a",
                render: (m) => [m.aplicaRetiro ? "Retiro" : null, m.aplicaEnvio ? "Envío" : null].filter(Boolean).join(" y "),
                hideBelow: "sm",
              },
              {
                key: "estado",
                header: "Estado",
                render: (m) => <Badge tone={m.activo ? "success" : "neutral"}>{m.activo ? "Activo" : "Inactivo"}</Badge>,
              },
              {
                key: "acciones",
                header: "",
                align: "right",
                render: (m) => {
                  const i = medios.findIndex((x) => x.slug === m.slug)
                  return (
                    <div className="flex gap-1 justify-end flex-wrap">
                      <Button size="sm" variant="ghost" disabled={guardando || i === 0} aria-label={`Subir ${m.nombre}`} onClick={() => void mover(m.slug, -1)}>
                        Subir
                      </Button>
                      <Button size="sm" variant="ghost" disabled={guardando || i === medios.length - 1} aria-label={`Bajar ${m.nombre}`} onClick={() => void mover(m.slug, 1)}>
                        Bajar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setErrores({}); setForm(desdeDto(m)) }}>
                        Editar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void alternarActivo(m)}>
                        {m.activo ? "Desactivar" : "Activar"}
                      </Button>
                      {m.slug !== SLUG_MERCADOPAGO && (
                        <Button size="sm" variant="ghost" onClick={() => setBorrar(m)}>
                          Eliminar
                        </Button>
                      )}
                    </div>
                  )
                },
              },
            ]}
          />
          <div>
            <Button variant="secondary" onClick={() => { setErrores({}); setForm({ ...formVacio }) }}>
              Agregar medio de pago
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
        title={form?.editandoSlug ? "Editar medio de pago" : "Agregar medio de pago"}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
            <Button loading={guardando} disabled={guardando} onClick={() => void guardar()}>Guardar</Button>
          </div>
        }
      >
        {form && (
          <div className="flex flex-col gap-3">
            <Field label="Nombre" hint="Es el nombre que ve el cliente." error={errores.nombre}>
              <Input value={form.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} aria-invalid={Boolean(errores.nombre)} />
            </Field>
            <Field
              label="Identificador"
              hint="De 2 a 30 caracteres: letras, números o guiones (se pasa a minúsculas y los espacios a guiones). Queda registrado en los pedidos y no se puede cambiar después."
              error={errores.slug}
            >
              <Input
                value={form.slug}
                disabled={Boolean(form.editandoSlug)}
                onChange={(e) => cambiar({ slug: normalizarIdentificador(e.target.value) })}
                aria-invalid={Boolean(errores.slug)}
              />
            </Field>
            <Field
              label="Instrucciones para el cliente"
              hint="Se muestran al elegir este medio de pago. No incluya datos que no quiera dejar visibles en la tienda."
              error={errores.instrucciones}
            >
              <Textarea rows={4} value={form.instrucciones} onChange={(e) => cambiar({ instrucciones: e.target.value })} aria-invalid={Boolean(errores.instrucciones)} />
            </Field>
            {form.editandoSlug && (
              <div className="flex flex-col gap-3">
                <Field
                  label="Lista de precios"
                  hint="Si el cliente elige este medio, se le cobra el precio de esta lista de precios online cuando es menor que el de la lista de referencia. Sin lista rige la de referencia. El cambio queda en el historial de Precios online."
                  error={errores.listaOnlineId}
                >
                  <Select
                    aria-label="Lista de precios"
                    value={form.listaOnlineId}
                    onValueChange={(v) => {
                      // Sin lista no hay precio distinto: se apagan el destacado y la ficha.
                      cambiar(v === LISTA_POR_DEFECTO ? { listaOnlineId: v, destacarEnCatalogo: false, mostrarEnFicha: false } : { listaOnlineId: v })
                    }}
                    options={[
                      { value: LISTA_POR_DEFECTO, label: "Lista de referencia" },
                      ...listas.map((l) => ({ value: l.id, label: l.nombre })),
                      // Una lista desactivada se sigue viendo hasta que se elija otra.
                      ...(form.listaOnlineId !== LISTA_POR_DEFECTO && !listas.some((l) => l.id === form.listaOnlineId)
                        ? [{ value: form.listaOnlineId, label: `${medios?.find((m) => m.slug === form.editandoSlug)?.listaOnlineNombre ?? "Lista"} (desactivada)` }]
                        : []),
                    ]}
                  />
                </Field>
                <Switch
                  id="medio-destacar"
                  label="Destacar en catálogo"
                  checked={form.destacarEnCatalogo}
                  disabled={form.listaOnlineId === LISTA_POR_DEFECTO}
                  onCheckedChange={(v) => cambiar({ destacarEnCatalogo: v })}
                />
                <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
                  Las tarjetas del catálogo muestran &quot;con {form.nombre || "este medio"}&quot; bajo el precio. Sólo un medio puede estar destacado: si destaca este, se quita del anterior.
                </p>
                <Switch
                  id="medio-ficha"
                  label="Mostrar en ficha"
                  checked={form.mostrarEnFicha}
                  disabled={form.listaOnlineId === LISTA_POR_DEFECTO}
                  onCheckedChange={(v) => cambiar({ mostrarEnFicha: v })}
                />
                <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
                  La ficha del producto muestra una línea con el precio de este medio. Puede marcar todos los que quiera.
                </p>
                {errores.destacarEnCatalogo && <p className="text-sm" style={{ color: "var(--red)" }}>{errores.destacarEnCatalogo}</p>}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <CheckboxLabel id="medio-retiro" checked={form.aplicaRetiro} onChange={(v) => cambiar({ aplicaRetiro: v })} label="Disponible para retiro en el local" />
              <CheckboxLabel id="medio-envio" checked={form.aplicaEnvio} onChange={(v) => cambiar({ aplicaEnvio: v })} label="Disponible para envío" />
              {errores.aplicaRetiro && <p className="text-sm" style={{ color: "var(--red)" }}>{errores.aplicaRetiro}</p>}
              <CheckboxLabel id="medio-online" checked={false} disabled onChange={() => {}} label="Cobro online" hint="Próximamente." />
              <CheckboxLabel id="medio-activo" checked={form.activo} onChange={(v) => cambiar({ activo: v })} label="Activo" hint="Un medio inactivo no se ofrece en el checkout." />
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
        title="Eliminar medio de pago"
        description="Se elimina definitivamente. Si algún pedido ya lo eligió, no se podrá eliminar: desactívelo para conservar el historial."
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setBorrar(null)}>Cancelar</Button>
            <Button variant="danger" loading={guardando} onClick={() => void confirmarBorrar()}>Eliminar</Button>
          </div>
        }
      >
        {borrar && <p className="text-sm" style={{ color: "var(--ink)" }}>¿Eliminar el medio de pago &quot;{borrar.nombre}&quot;?</p>}
      </Dialog>
    </Card>
  )
}
