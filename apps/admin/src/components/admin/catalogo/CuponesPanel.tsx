"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Alert, Badge, Button, Checkbox, Dialog, EmptyState, Field, Input, Select, Switch, Table, Textarea, type TableColumn } from "@myd-org/ui"
import type { CanjeDto } from "@/lib/cupones-canjes"
import type { PromocionDto } from "@/lib/cupones-repo"
import type { MedioPagoDto } from "@/lib/medios-pago-shop-repo"
import { PROVINCIAS, claveProvincia } from "@/lib/provincias"
import { fmtVentana } from "./campanias-ui"
import {
  FORMAS,
  ROTULO_ESTADO_CANJE,
  ROTULO_ESTADO_PROMO,
  TEXTOS_CUPONES as TX,
  cuerpoPromocion,
  formDesdeDto,
  formVacioPromocion,
  textoBeneficio,
  type FormPromocion,
} from "./cupones-ui"
import { fmtPrecio } from "./precios-online-textos"
import { api, ErrorApi } from "./tipos"

const SLUG_A_COORDINAR = "a_coordinar"

type Confirmar = { tipo: "pausar" | "eliminar" | "revocar"; promo: PromocionDto } | null

const mensaje = (e: unknown) => (e instanceof ErrorApi ? e.message : String(e))

/**
 * Solapa "Cupones" del catálogo (spec 2026-11-01-cupones-design.md): promociones genéricas o de
 * códigos únicos, lote en CSV para volantes y el token del bot de Instagram (se muestra una vez).
 */
export function CuponesPanel() {
  const [promos, setPromos] = useState<PromocionDto[] | null>(null)
  const [medios, setMedios] = useState<{ slug: string; nombre: string }[]>([])
  const [error, setError] = useState("")
  const [form, setForm] = useState<FormPromocion | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [errorForm, setErrorForm] = useState("")
  const [confirmar, setConfirmar] = useState<Confirmar>(null)
  const [lote, setLote] = useState<{ promo: PromocionDto; cantidad: string; error: string } | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [canjes, setCanjes] = useState<{ promo: PromocionDto; filas: CanjeDto[] } | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const disponibles = [...medios.map((m) => m.slug), SLUG_A_COORDINAR]

  const cargar = useCallback(async () => {
    try {
      const r = await api<{ promociones: PromocionDto[] }>("/api/admin/cupones")
      setPromos(r.promociones)
      setError("")
    } catch (e) {
      setError(mensaje(e))
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del panel
    void cargar()
    api<{ medios: MedioPagoDto[] }>("/api/admin/medios-pago-shop")
      .then((r) => setMedios(r.medios.filter((m) => m.activo && m.audiencia !== "cuenta_corriente").map((m) => ({ slug: m.slug, nombre: m.nombre }))))
      .catch(() => setMedios([]))
  }, [cargar])

  function abrirNueva() {
    setEditando(null)
    setForm(formVacioPromocion(disponibles))
    setErrorForm("")
  }

  function abrirEdicion(p: PromocionDto) {
    setEditando(p.id)
    setForm(formDesdeDto(p, disponibles))
    setErrorForm("")
  }

  async function guardar() {
    if (!form) return
    setOcupado(true)
    try {
      await api(editando ? `/api/admin/cupones/${editando}` : "/api/admin/cupones", {
        method: editando ? "PUT" : "POST",
        body: JSON.stringify(cuerpoPromocion(form, disponibles)),
      })
      setForm(null)
      await cargar()
    } catch (e) {
      setErrorForm(mensaje(e))
    } finally {
      setOcupado(false)
    }
  }

  async function cambiarActiva(p: PromocionDto, activa: boolean) {
    try {
      await api(`/api/admin/cupones/${p.id}`, { method: "PATCH", body: JSON.stringify({ activa }) })
      await cargar()
    } catch (e) {
      setError(mensaje(e))
    }
  }

  async function ejecutarConfirmado() {
    if (!confirmar) return
    const { tipo, promo } = confirmar
    setConfirmar(null)
    if (tipo === "pausar") return cambiarActiva(promo, false)
    try {
      await api(tipo === "eliminar" ? `/api/admin/cupones/${promo.id}` : `/api/admin/cupones/${promo.id}/token`, { method: "DELETE" })
      await cargar()
    } catch (e) {
      setError(mensaje(e))
    }
  }

  async function verCanjes(p: PromocionDto) {
    try {
      const r = await api<{ canjes: CanjeDto[] }>(`/api/admin/cupones/${p.id}`)
      setCanjes({ promo: p, filas: r.canjes })
    } catch (e) {
      setError(mensaje(e))
    }
  }

  async function generarToken(p: PromocionDto) {
    try {
      const r = await api<{ token: string }>(`/api/admin/cupones/${p.id}/token`, { method: "POST" })
      setToken(r.token)
      await cargar()
    } catch (e) {
      setError(mensaje(e))
    }
  }

  async function descargarLote() {
    if (!lote) return
    setOcupado(true)
    try {
      const res = await fetch(`/api/admin/cupones/${lote.promo.id}/lote`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cantidad: Number(lote.cantidad.trim()) }),
      })
      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null
        setLote({ ...lote, error: cuerpo?.error ?? "No se pudo generar el lote. Inténtelo de nuevo." })
        return
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement("a")
      a.href = url
      a.download = `cupones-${lote.promo.prefijo ?? "lote"}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setLote(null)
      await cargar()
    } catch {
      setLote({ ...lote, error: "No pudimos conectarnos. Revise su conexión e inténtelo nuevamente." })
    } finally {
      setOcupado(false)
    }
  }

  const alternar = <K extends "medios" | "formas" | "provincias">(campo: K, valor: FormPromocion[K][number], si: boolean) =>
    setForm((f) => {
      if (!f) return f
      const actual = f[campo] as string[]
      const nuevo = si ? [...new Set([...actual, valor as string])] : actual.filter((x) => x !== valor)
      return { ...f, [campo]: nuevo }
    })

  const columnas: TableColumn<PromocionDto>[] = [
    {
      key: "nombre",
      header: TX.columnas.nombre,
      render: (p) => (
        <span>
          {p.nombre}
          <span className="block text-xs" style={{ color: "var(--ink-soft)" }}>
            {TX.tipoCorto[p.tipo]} · {p.tipo === "generica" ? p.codigo : `${p.prefijo}-…`}
          </span>
        </span>
      ),
    },
    { key: "beneficio", header: TX.columnas.beneficio, render: (p) => textoBeneficio(p) },
    { key: "vigencia", header: TX.columnas.vigencia, render: (p) => <span className="tabular-nums">{fmtVentana(p.inicio, p.fin)}</span> },
    {
      key: "estado",
      header: TX.columnas.estado,
      render: (p) => <Badge tone={ROTULO_ESTADO_PROMO[p.estado].tono}>{ROTULO_ESTADO_PROMO[p.estado].texto}</Badge>,
    },
    { key: "emitidos", header: TX.columnas.emitidos, align: "right", render: (p) => <span className="tabular-nums">{p.codigosEmitidos}</span> },
    {
      key: "canjes",
      header: TX.columnas.canjes,
      align: "right",
      render: (p) => (
        <span className="tabular-nums">
          {p.canjesUsados}
          {p.limiteCanjes !== null && ` / ${p.limiteCanjes}`}
        </span>
      ),
    },
    { key: "descuento", header: TX.columnas.descuento, align: "right", render: (p) => <span className="tabular-nums">{fmtPrecio(p.descuentoTotal)}</span> },
    {
      key: "acciones",
      header: "",
      align: "right",
      render: (p) => (
        <span className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => verCanjes(p)}>
            {TX.verCanjes}
          </Button>
          {p.estado !== "terminada" && (
            <Button size="sm" variant="outline" onClick={() => abrirEdicion(p)}>
              {TX.editar}
            </Button>
          )}
          {p.estado !== "terminada" &&
            (p.activa ? (
              <Button size="sm" variant="outline" onClick={() => setConfirmar({ tipo: "pausar", promo: p })}>
                {TX.pausar}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => cambiarActiva(p, true)}>
                {TX.reanudar}
              </Button>
            ))}
          {p.tipo === "unicos" && p.estado !== "terminada" && (
            <>
              <Button size="sm" variant="outline" onClick={() => setLote({ promo: p, cantidad: "100", error: "" })}>
                {TX.generarLote}
              </Button>
              <Button size="sm" variant="outline" onClick={() => generarToken(p)}>
                {p.tieneToken ? TX.regenerarToken : TX.generarToken}
              </Button>
              {p.tieneToken && (
                <Button size="sm" variant="outline" onClick={() => setConfirmar({ tipo: "revocar", promo: p })}>
                  {TX.revocarToken}
                </Button>
              )}
            </>
          )}
          {p.canjesUsados === 0 && (
            <Button size="sm" variant="outline" onClick={() => setConfirmar({ tipo: "eliminar", promo: p })}>
              {TX.eliminar}
            </Button>
          )}
        </span>
      ),
    },
  ]

  const textoConfirmar = confirmar
    ? confirmar.tipo === "pausar"
      ? TX.confirmarPausar(confirmar.promo.nombre)
      : confirmar.tipo === "eliminar"
        ? TX.confirmarEliminar(confirmar.promo.nombre)
        : TX.confirmarRevocar(confirmar.promo.nombre)
    : undefined
  const tituloConfirmar = confirmar?.tipo === "pausar" ? TX.pausar : confirmar?.tipo === "eliminar" ? TX.eliminar : TX.revocarToken

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          {TX.ayuda}
        </p>
        <Button onClick={abrirNueva}>{TX.nueva}</Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {promos && promos.length === 0 ? (
        <EmptyState title={TX.vacio} />
      ) : (
        <Table columns={columnas} rows={promos ?? []} rowKey={(p) => p.id} />
      )}

      <Dialog
        open={form !== null}
        onOpenChange={(v) => !v && setForm(null)}
        title={editando ? TX.editar : TX.nueva}
        dismissible={false}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setForm(null)}>
              {TX.cancelar}
            </Button>
            <Button onClick={guardar} disabled={ocupado}>
              {TX.guardar}
            </Button>
          </div>
        }
      >
        {form && (
          <div className="flex flex-col gap-3">
            {errorForm && <Alert tone="danger">{errorForm}</Alert>}
            <Field label={TX.nombre} hint={TX.nombreAyuda}>
              <Input value={form.nombre} maxLength={80} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={TX.tipo}>
                <Select
                  value={form.tipo}
                  onValueChange={(v) => setForm({ ...form, tipo: v as FormPromocion["tipo"] })}
                  options={[
                    { value: "unicos", label: TX.tipoUnicos },
                    { value: "generica", label: TX.tipoGenerica },
                  ]}
                />
              </Field>
              {form.tipo === "generica" ? (
                <Field label={TX.codigo} hint={TX.codigoAyuda}>
                  <Input value={form.codigo} maxLength={32} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
                </Field>
              ) : (
                <Field label={TX.prefijo} hint={TX.prefijoAyuda}>
                  <Input value={form.prefijo} maxLength={8} onChange={(e) => setForm({ ...form, prefijo: e.target.value })} />
                </Field>
              )}
            </div>
            {form.tipo === "unicos" && (
              <Field label={TX.venceDias}>
                <Input inputMode="numeric" value={form.venceDias} onChange={(e) => setForm({ ...form, venceDias: e.target.value })} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={TX.descuento} hint={TX.descuentoAyuda}>
                <Input inputMode="numeric" value={form.pct} onChange={(e) => setForm({ ...form, pct: e.target.value })} />
              </Field>
              <div className="flex items-end pb-2">
                <Switch
                  id="cupon-envio-gratis"
                  checked={form.envioGratis}
                  onCheckedChange={(v) => setForm({ ...form, envioGratis: v })}
                  label={TX.envioGratis}
                />
              </div>
            </div>
            {form.envioGratis && (
              <Field label={TX.provincias} hint={TX.provinciasAyuda}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={TX.provincias}>
                  {PROVINCIAS.map((p) => {
                    const clave = claveProvincia(p)
                    const id = `cupon-prov-${clave}`
                    return (
                      <label key={clave} htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                        <Checkbox id={id} checked={form.provincias.includes(clave)} onCheckedChange={(v) => alternar("provincias", clave, v)} />
                        {p}
                      </label>
                    )
                  })}
                </div>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={TX.inicio} hint={TX.horaAyuda}>
                <span className="flex gap-2">
                  <Input type="date" value={form.inicioFecha} onChange={(e) => setForm({ ...form, inicioFecha: e.target.value })} />
                  <Input type="time" value={form.inicioHora} onChange={(e) => setForm({ ...form, inicioHora: e.target.value })} />
                </span>
              </Field>
              <Field label={TX.fin} hint={TX.horaAyuda}>
                <span className="flex gap-2">
                  <Input type="date" value={form.finFecha} onChange={(e) => setForm({ ...form, finFecha: e.target.value })} />
                  <Input type="time" value={form.finHora} onChange={(e) => setForm({ ...form, finHora: e.target.value })} />
                </span>
              </Field>
            </div>
            <Switch
              id="cupon-primera-compra"
              checked={form.soloPrimeraCompra}
              onCheckedChange={(v) => setForm({ ...form, soloPrimeraCompra: v })}
              label={TX.primeraCompra}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label={TX.minimo} hint={TX.minimoAyuda}>
                <Input inputMode="decimal" value={form.minimo} onChange={(e) => setForm({ ...form, minimo: e.target.value })} />
              </Field>
              <Field label={TX.limite}>
                <Input inputMode="numeric" value={form.limite} onChange={(e) => setForm({ ...form, limite: e.target.value })} />
              </Field>
            </div>
            <Field label={TX.medios} hint={TX.mediosAyuda}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label={TX.medios}>
                {[...medios, { slug: SLUG_A_COORDINAR, nombre: TX.aCoordinar }].map((m) => {
                  const id = `cupon-medio-${m.slug}`
                  return (
                    <label key={m.slug} htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                      <Checkbox id={id} checked={form.medios.includes(m.slug)} onCheckedChange={(v) => alternar("medios", m.slug, v)} />
                      {m.nombre}
                    </label>
                  )
                })}
              </div>
            </Field>
            <Field label={TX.formas}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label={TX.formas}>
                {FORMAS.map((f) => {
                  const id = `cupon-forma-${f.value}`
                  return (
                    <label key={f.value} htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                      <Checkbox id={id} checked={form.formas.includes(f.value)} onCheckedChange={(v) => alternar("formas", f.value, v)} />
                      {f.label}
                    </label>
                  )
                })}
              </div>
            </Field>
            <Switch
              id="cupon-cuotas"
              checked={form.permiteCuotas}
              onCheckedChange={(v) => setForm({ ...form, permiteCuotas: v })}
              label={TX.cuotas}
            />
            <Field label={TX.condiciones} hint={TX.condicionesAyuda}>
              <Textarea value={form.condiciones} maxLength={2000} rows={3} onChange={(e) => setForm({ ...form, condiciones: e.target.value })} />
            </Field>
          </div>
        )}
      </Dialog>

      <Dialog
        open={lote !== null}
        onOpenChange={(v) => !v && setLote(null)}
        title={TX.generarLote}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setLote(null)}>
              {TX.cancelar}
            </Button>
            <Button onClick={descargarLote} disabled={ocupado}>
              {TX.descargar}
            </Button>
          </div>
        }
      >
        {lote && (
          <div className="flex flex-col gap-3">
            {lote.error && <Alert tone="danger">{lote.error}</Alert>}
            <Field label={TX.cantidad}>
              <Input inputMode="numeric" value={lote.cantidad} onChange={(e) => setLote({ ...lote, cantidad: e.target.value })} />
            </Field>
          </div>
        )}
      </Dialog>

      <Dialog
        open={canjes !== null}
        onOpenChange={(v) => !v && setCanjes(null)}
        title={canjes ? TX.canjesTitulo(canjes.promo.nombre) : ""}
        size="lg"
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setCanjes(null)}>{TX.cerrar}</Button>
          </div>
        }
      >
        {canjes &&
          (canjes.filas.length === 0 ? (
            <EmptyState title={TX.sinCanjes} />
          ) : (
            <Table
              columns={[
                {
                  key: "pedido",
                  header: TX.columnasCanje.pedido,
                  render: (k: CanjeDto) => (
                    <Link href={`/admin/pedidos/${k.pedidoId}`} className="font-medium tabular-nums hover:underline" style={{ color: "var(--ink)" }}>
                      {k.numero}
                    </Link>
                  ),
                },
                { key: "fecha", header: TX.columnasCanje.fecha, render: (k: CanjeDto) => <span className="tabular-nums">{new Date(k.fecha).toLocaleDateString("es-AR")}</span> },
                {
                  key: "estado",
                  header: TX.columnasCanje.estado,
                  render: (k: CanjeDto) => (
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={ROTULO_ESTADO_CANJE[k.estado].tono}>{ROTULO_ESTADO_CANJE[k.estado].texto}</Badge>
                      {k.duplicado && <Badge tone="warning">{TX.duplicado}</Badge>}
                    </span>
                  ),
                },
                { key: "descuento", header: TX.columnasCanje.descuento, align: "right", render: (k: CanjeDto) => <span className="tabular-nums">{fmtPrecio(k.descuento)}</span> },
              ]}
              rows={canjes.filas}
              rowKey={(k) => k.pedidoId}
            />
          ))}
      </Dialog>

      <Dialog
        open={token !== null}
        onOpenChange={(v) => !v && setToken(null)}
        title={TX.tokenTitulo}
        description={TX.tokenAviso}
        footer={
          <div className="flex justify-end">
            <Button onClick={() => setToken(null)}>{TX.cerrar}</Button>
          </div>
        }
      >
        {token && <Input readOnly value={token} onFocus={(e) => e.currentTarget.select()} className="font-mono" />}
      </Dialog>

      <Dialog
        open={confirmar !== null}
        onOpenChange={(v) => !v && setConfirmar(null)}
        title={tituloConfirmar}
        description={textoConfirmar}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmar(null)}>
              {TX.cancelar}
            </Button>
            <Button onClick={ejecutarConfirmado}>{tituloConfirmar}</Button>
          </div>
        }
      />
    </section>
  )
}
