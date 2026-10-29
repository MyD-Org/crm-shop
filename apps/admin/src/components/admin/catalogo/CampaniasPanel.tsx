"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Alert, Badge, Button, Dialog, EmptyState, Field, Input, Select, Table, type TableColumn } from "@myd-org/ui"
import type { CampaniaDetalleDto, CampaniaDto, PreviaCampania } from "@/lib/campanias-repo"
import type { MarcaDto } from "@/lib/precios-online-repo"
import { BuscadorProducto } from "./BuscadorProducto"
import {
  ROTULO_ESTADO,
  TEXTOS_CAMPANIAS as TX,
  cuerpoCampania,
  deIsoArgentina,
  fmtVentana,
  type FormCampania,
  type FormRegla,
  type TipoRegla,
} from "./campanias-ui"
import { fmtPrecio } from "./precios-online-textos"
import { api, ErrorApi, type CategoriaDto } from "./tipos"

interface Props {
  categorias: CategoriaDto[]
}

type Confirmar = { tipo: "terminar" | "eliminar"; campania: CampaniaDto } | null

let siguienteClave = 0
const nuevaClave = () => `r${++siguienteClave}`

const reglaVacia = (): FormRegla => ({
  clave: nuevaClave(),
  tipo: "marca",
  marca: "",
  categoriaId: "",
  producto: null,
  pct: "",
  unidades: "",
})

function formVacio(): FormCampania {
  return { nombre: "", etiqueta: "", inicioFecha: "", inicioHora: "00:00", finFecha: "", finHora: "23:59", reglas: [reglaVacia()] }
}

function formDe(c: CampaniaDetalleDto): FormCampania {
  const i = deIsoArgentina(c.inicio)
  const f = deIsoArgentina(c.fin)
  return {
    nombre: c.nombre,
    etiqueta: c.etiqueta === c.nombre ? "" : c.etiqueta,
    inicioFecha: i.fecha,
    inicioHora: i.hora,
    finFecha: f.fecha,
    finHora: f.hora,
    reglas: c.reglas.map((r) => ({
      clave: nuevaClave(),
      tipo: r.alcance.tipo,
      marca: r.alcance.tipo === "marca" ? r.alcance.marca : "",
      categoriaId: r.alcance.tipo === "categoria" ? r.alcance.categoriaId : "",
      producto: r.alcance.tipo === "producto" ? { alegraId: r.alcance.alegraId, nombre: r.descripcion ?? r.alcance.alegraId, code: null } : null,
      pct: String(r.pct),
      unidades: r.unidades != null ? String(r.unidades) : "",
    })),
  }
}

/**
 * Solapa "Campañas" del catálogo: descuentos con fecha y hora de inicio y de fin sobre el precio
 * online normal (spec 2026-10-28-campanias-precios-design.md). Nada se guarda sin vista previa:
 * muestra los productos alcanzados, una muestra de precios y cuántos quedarían bajo el costo.
 */
export function CampaniasPanel({ categorias }: Props) {
  const [campanias, setCampanias] = useState<CampaniaDto[] | null>(null)
  const [marcas, setMarcas] = useState<MarcaDto[]>([])
  const [error, setError] = useState("")
  const [form, setForm] = useState<FormCampania | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [errorForm, setErrorForm] = useState("")
  const [previa, setPrevia] = useState<{ cuerpo: string; datos: PreviaCampania } | null>(null)
  const [confirmarBajoCosto, setConfirmarBajoCosto] = useState(false)
  const [confirmar, setConfirmar] = useState<Confirmar>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const r = await api<{ campanias: CampaniaDto[] }>("/api/admin/campanias")
      setCampanias(r.campanias)
      setError("")
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del panel
    void cargar()
    api<{ marcas?: MarcaDto[] }>("/api/admin/precios-online/listas")
      .then((r) => setMarcas(r.marcas ?? []))
      .catch(() => setMarcas([]))
  }, [cargar])

  const cuerpo = useMemo(() => (form ? JSON.stringify(cuerpoCampania(form)) : ""), [form])
  const previaVigente = previa && previa.cuerpo === cuerpo ? previa.datos : null

  function abrirNueva() {
    setEditando(null)
    setForm(formVacio())
    setPrevia(null)
    setErrorForm("")
  }

  async function abrirEdicion(c: CampaniaDto) {
    try {
      const r = await api<{ campania: CampaniaDetalleDto }>(`/api/admin/campanias/${c.id}`)
      setEditando(c.id)
      setForm(formDe(r.campania))
      setPrevia(null)
      setErrorForm("")
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : String(e))
    }
  }

  const cambiarRegla = (clave: string, cambio: Partial<FormRegla>) =>
    setForm((f) => (f ? { ...f, reglas: f.reglas.map((r) => (r.clave === clave ? { ...r, ...cambio } : r)) } : f))

  async function pedirPrevia() {
    if (!form) return
    setOcupado(true)
    try {
      const r = await api<{ previa: PreviaCampania }>("/api/admin/campanias/previsualizar", {
        method: "POST",
        body: JSON.stringify({ campania: cuerpoCampania(form), ...(editando ? { exceptoId: editando } : {}) }),
      })
      setPrevia({ cuerpo, datos: r.previa })
      setErrorForm("")
    } catch (e) {
      setErrorForm(e instanceof ErrorApi ? e.message : String(e))
    } finally {
      setOcupado(false)
    }
  }

  async function guardar() {
    if (!form) return
    setOcupado(true)
    try {
      await api(editando ? `/api/admin/campanias/${editando}` : "/api/admin/campanias", {
        method: editando ? "PUT" : "POST",
        body: JSON.stringify(cuerpoCampania(form)),
      })
      setForm(null)
      setPrevia(null)
      setConfirmarBajoCosto(false)
      await cargar()
    } catch (e) {
      setConfirmarBajoCosto(false)
      setErrorForm(e instanceof ErrorApi ? e.message : String(e))
    } finally {
      setOcupado(false)
    }
  }

  async function ejecutarConfirmado() {
    if (!confirmar) return
    const { tipo, campania } = confirmar
    setConfirmar(null)
    try {
      await api(tipo === "terminar" ? `/api/admin/campanias/${campania.id}/terminar` : `/api/admin/campanias/${campania.id}`, {
        method: tipo === "terminar" ? "POST" : "DELETE",
        ...(tipo === "terminar" ? { body: JSON.stringify({}) } : {}),
      })
      await cargar()
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : String(e))
    }
  }

  const columnas: TableColumn<CampaniaDto>[] = [
    {
      key: "nombre",
      header: TX.columnas.nombre,
      render: (c) => (
        <span>
          {c.nombre}
          {c.etiqueta !== c.nombre && (
            <span className="block text-xs" style={{ color: "var(--ink-soft)" }}>
              {c.etiqueta}
            </span>
          )}
        </span>
      ),
    },
    { key: "ventana", header: TX.columnas.ventana, render: (c) => <span className="tabular-nums">{fmtVentana(c.inicio, c.fin)}</span> },
    {
      key: "estado",
      header: TX.columnas.estado,
      render: (c) => <Badge tone={ROTULO_ESTADO[c.estado].tono}>{ROTULO_ESTADO[c.estado].texto}</Badge>,
    },
    { key: "productos", header: TX.columnas.productos, align: "right", render: (c) => <span className="tabular-nums">{c.productos}</span> },
    {
      key: "acciones",
      header: "",
      align: "right",
      render: (c) => (
        <span className="flex justify-end gap-2">
          {c.estado !== "terminada" && (
            <Button size="sm" variant="outline" onClick={() => abrirEdicion(c)}>
              {TX.editar}
            </Button>
          )}
          {c.estado === "activa" && (
            <Button size="sm" variant="outline" onClick={() => setConfirmar({ tipo: "terminar", campania: c })}>
              {TX.terminar}
            </Button>
          )}
          {c.estado === "programada" && (
            <Button size="sm" variant="outline" onClick={() => setConfirmar({ tipo: "eliminar", campania: c })}>
              {TX.eliminar}
            </Button>
          )}
        </span>
      ),
    },
  ]

  const opcionesCategoria = categorias.map((c) => ({ value: c.id, label: `${"— ".repeat(Math.max(0, c.nivel - 1))}${c.nombre}` }))

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          {TX.ayuda}
        </p>
        <Button onClick={abrirNueva}>{TX.nueva}</Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {campanias && campanias.length === 0 ? (
        <EmptyState title={TX.vacio} />
      ) : (
        <Table columns={columnas} rows={campanias ?? []} rowKey={(c) => c.id} />
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
            <Button variant="outline" onClick={pedirPrevia} disabled={ocupado}>
              {TX.vistaPrevia}
            </Button>
            <Button
              onClick={() => (previaVigente && previaVigente.bajoCosto > 0 ? setConfirmarBajoCosto(true) : guardar())}
              disabled={ocupado || !previaVigente || previaVigente.choque !== null}
            >
              {TX.guardar}
            </Button>
          </div>
        }
      >
        {form && (
          <div className="flex flex-col gap-3">
            {errorForm && <Alert tone="danger">{errorForm}</Alert>}
            <Field label={TX.nombre}>
              <Input value={form.nombre} maxLength={80} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
            </Field>
            <Field label={TX.etiqueta} hint={TX.etiquetaAyuda}>
              <Input value={form.etiqueta} maxLength={24} onChange={(e) => setForm({ ...form, etiqueta: e.target.value })} />
            </Field>
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

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                {TX.reglas}
              </span>
              <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
                {TX.reglasAyuda}
              </p>
              {form.reglas.map((r) => (
                <div key={r.clave} className="grid grid-cols-[9rem_1fr_6rem_7rem_auto] items-end gap-2">
                  <Field label={TX.alcance}>
                    <Select
                      value={r.tipo}
                      onValueChange={(v) => cambiarRegla(r.clave, { tipo: v as TipoRegla })}
                      options={[
                        { value: "producto", label: TX.producto },
                        { value: "marca", label: TX.marca },
                        { value: "categoria", label: TX.categoria },
                      ]}
                    />
                  </Field>
                  {r.tipo === "producto" ? (
                    <Field label={TX.producto}>
                      <BuscadorProducto
                        elegidos={r.producto ? [r.producto] : []}
                        onCambiar={(p) => cambiarRegla(r.clave, { producto: p.at(-1) ?? null })}
                      />
                    </Field>
                  ) : r.tipo === "marca" ? (
                    <Field label={TX.marca}>
                      <Select
                        value={r.marca}
                        onValueChange={(v) => cambiarRegla(r.clave, { marca: v })}
                        placeholder="Seleccione una marca"
                        options={marcas.map((m) => ({ value: m.clave, label: m.nombre }))}
                      />
                    </Field>
                  ) : (
                    <Field label={TX.categoria}>
                      <Select
                        value={r.categoriaId}
                        onValueChange={(v) => cambiarRegla(r.clave, { categoriaId: v })}
                        placeholder="Seleccione una categoría"
                        options={opcionesCategoria}
                      />
                    </Field>
                  )}
                  <Field label={TX.descuento}>
                    <Input inputMode="numeric" value={r.pct} onChange={(e) => cambiarRegla(r.clave, { pct: e.target.value })} />
                  </Field>
                  <Field label={TX.unidades}>
                    <Input
                      inputMode="numeric"
                      value={r.unidades}
                      disabled={r.tipo !== "producto"}
                      onChange={(e) => cambiarRegla(r.clave, { unidades: e.target.value })}
                    />
                  </Field>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={form.reglas.length === 1}
                    onClick={() => setForm({ ...form, reglas: form.reglas.filter((x) => x.clave !== r.clave) })}
                  >
                    {TX.quitar}
                  </Button>
                </div>
              ))}
              <div>
                <Button variant="outline" size="sm" onClick={() => setForm({ ...form, reglas: [...form.reglas, reglaVacia()] })}>
                  {TX.agregarRegla}
                </Button>
              </div>
            </div>

            {previaVigente ? (
              <VistaPrevia previa={previaVigente} />
            ) : (
              <Alert tone="neutral">{TX.sinPrevia}</Alert>
            )}
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmarBajoCosto}
        onOpenChange={(v) => !v && setConfirmarBajoCosto(false)}
        title={TX.guardar}
        description={previaVigente ? TX.confirmarBajoCosto(previaVigente.bajoCosto) : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmarBajoCosto(false)}>
              {TX.cancelar}
            </Button>
            <Button onClick={guardar} disabled={ocupado}>
              {TX.guardar}
            </Button>
          </div>
        }
      />

      <Dialog
        open={confirmar !== null}
        onOpenChange={(v) => !v && setConfirmar(null)}
        title={confirmar?.tipo === "terminar" ? TX.terminar : TX.eliminar}
        description={
          confirmar
            ? confirmar.tipo === "terminar"
              ? TX.confirmarTerminar(confirmar.campania.nombre)
              : TX.confirmarEliminar(confirmar.campania.nombre)
            : undefined
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmar(null)}>
              {TX.cancelar}
            </Button>
            <Button onClick={ejecutarConfirmado}>{confirmar?.tipo === "terminar" ? TX.terminar : TX.eliminar}</Button>
          </div>
        }
      />
    </section>
  )
}

function VistaPrevia({ previa }: { previa: PreviaCampania }) {
  return (
    <div className="flex flex-col gap-2">
      {previa.choque && <Alert tone="danger">{TX.choque(previa.choque.nombre)}</Alert>}
      <Alert tone={previa.bajoCosto > 0 ? "warning" : "neutral"}>
        {TX.productosAlcanzados(previa.productos)}
        {previa.bajoCosto > 0 && ` ${TX.bajoCosto(previa.bajoCosto)}`}
      </Alert>
      {previa.muestra.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--ink-soft)" }}>
              <th className="text-left font-normal">{TX.muestra}</th>
              <th className="text-right font-normal">{TX.costo}</th>
              <th className="text-right font-normal">{TX.normal}</th>
              <th className="text-right font-normal">{TX.conCampania}</th>
            </tr>
          </thead>
          <tbody>
            {previa.muestra.flatMap((f) =>
              f.precios.map((p, i) => {
                const bajo = f.costo != null && p.campania < f.costo
                return (
                  <tr key={`${f.alegraId}-${p.lista}`}>
                    <td>{i === 0 ? f.nombre : ""}<span className="block text-xs" style={{ color: "var(--ink-soft)" }}>{p.lista}</span></td>
                    <td className="text-right tabular-nums">{i === 0 ? fmtPrecio(f.costo) : ""}</td>
                    <td className="text-right tabular-nums">{fmtPrecio(p.normal)}</td>
                    <td className="text-right tabular-nums" style={bajo ? { color: "var(--danger)" } : undefined}>
                      {fmtPrecio(p.campania)}
                    </td>
                  </tr>
                )
              }),
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
