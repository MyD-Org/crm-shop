"use client"

import { useCallback, useEffect, useState } from "react"
import { Info, Settings } from "lucide-react"
import { Alert, Badge, Button, Dialog, EmptyState, Field, Input, Select, Tooltip } from "@myd-org/ui"
import type { CambioPrecios } from "@/lib/precios-online-cambios"
import type { ConfigPrecios, ListaDto } from "@/lib/precios-online-repo"
import { VistaPreviaDialog } from "./VistaPreviaDialog"
import { TEXTOS, fmtCoef } from "./precios-online-textos"
import { api, ErrorApi, type CategoriaDto } from "./tipos"

interface Props {
  categorias: CategoriaDto[]
  /** Se llama tras aplicar un cambio (la grilla y las alertas se recargan). */
  onCambio: () => void
}

type Previa = { cambios: CambioPrecios[]; titulo: string; nombre: string }
type FormLista = { id: string | null; nombre: string; coeficiente: string; orden: string }
type FormAjuste = { listaId: string; tipo: "marca" | "categoria"; marca: string; categoriaId: string; coeficiente: string }

/** "1,6" -> "1.6": el servidor valida el formato. */
const aPunto = (v: string) => v.trim().replace(",", ".")

/**
 * Solapa "Listas": alta, edición, referencia, activación y baja de las listas de precio online,
 * sus ajustes por marca o categoría y los umbrales. Ningún cambio se aplica directo: todos pasan
 * por la vista previa (VistaPreviaDialog), que muestra el efecto y exige confirmación.
 */
export function ListasPrecioPanel({ categorias, onCambio }: Props) {
  const [listas, setListas] = useState<ListaDto[] | null>(null)
  const [config, setConfig] = useState<ConfigPrecios | null>(null)
  const [error, setError] = useState("")
  const [form, setForm] = useState<FormLista | null>(null)
  const [ajuste, setAjuste] = useState<FormAjuste | null>(null)
  const [errorForm, setErrorForm] = useState("")
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [umbrales, setUmbrales] = useState({ confirmacion: "", retencion: "" })

  const cargar = useCallback(async () => {
    try {
      const r = await api<{ listas: ListaDto[]; config: ConfigPrecios }>("/api/admin/precios-online/listas")
      setListas(r.listas)
      setConfig(r.config)
      setUmbrales({ confirmacion: r.config.umbralConfirmacionPct.replace(".", ","), retencion: r.config.umbralRetencionPct.replace(".", ",") })
      setError("")
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : TEXTOS.grilla.errorCarga)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await cargar()
    })()
  }, [cargar])

  const nombreReferencia = listas?.find((l) => l.esReferencia)?.nombre ?? listas?.[0]?.nombre ?? ""

  const pedirPrevia = (cambios: CambioPrecios[], titulo: string, nombre?: string) =>
    setPrevia({ cambios, titulo, nombre: nombre ?? nombreReferencia })

  const guardarLista = () => {
    if (!form) return
    const coeficiente = aPunto(form.coeficiente)
    const orden = form.orden.trim() === "" ? undefined : Number(form.orden)
    if (orden !== undefined && !Number.isInteger(orden)) {
      setErrorForm("El orden indicado no es válido.")
      return
    }
    const cambio: CambioPrecios = form.id
      ? { op: "editarLista", listaId: form.id, nombre: form.nombre, coeficiente, ...(orden !== undefined ? { orden } : {}) }
      : { op: "crearLista", nombre: form.nombre, coeficiente, ...(orden !== undefined ? { orden } : {}) }
    setErrorForm("")
    setForm(null)
    pedirPrevia([cambio], form.id ? `${TEXTOS.listas.editar}: ${form.nombre}` : TEXTOS.listas.nueva, form.nombre)
  }

  const guardarAjuste = () => {
    if (!ajuste) return
    const coeficiente = aPunto(ajuste.coeficiente)
    const cambio: CambioPrecios =
      ajuste.tipo === "marca"
        ? { op: "upsertOverride", listaId: ajuste.listaId, tipo: "marca", marca: ajuste.marca, coeficiente }
        : { op: "upsertOverride", listaId: ajuste.listaId, tipo: "categoria", categoriaId: ajuste.categoriaId, coeficiente }
    const lista = listas?.find((l) => l.id === ajuste.listaId)
    setAjuste(null)
    pedirPrevia([cambio], TEXTOS.listas.nuevoAjuste, lista?.nombre)
  }

  const [avanzados, setAvanzados] = useState(false)

  /** Ícono de información con la explicación del umbral (tooltip del DS; accesible con teclado). */
  const info = (texto: string) => (
    <Tooltip content={texto} side="top">
      <span tabIndex={0} role="img" aria-label={`${TEXTOS.listas.masInformacion}: ${texto}`} className="inline-flex">
        <Info size={14} aria-hidden="true" />
      </span>
    </Tooltip>
  )

  const guardarUmbrales = () => {
    setAvanzados(false)
    pedirPrevia(
      [{ op: "setUmbrales", confirmacionPct: aPunto(umbrales.confirmacion), retencionPct: aPunto(umbrales.retencion) }],
      TEXTOS.listas.umbrales,
    )
  }

  const [confirmarBaja, setConfirmarBaja] = useState<ListaDto | null>(null)

  return (
    <section className="flex flex-col gap-6" aria-label={TEXTOS.listas.titulo}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">{TEXTOS.listas.titulo}</h2>
        <Button onClick={() => setForm({ id: null, nombre: "", coeficiente: "", orden: "" })}>{TEXTOS.listas.nueva}</Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {listas && listas.length === 0 && <EmptyState title={TEXTOS.listas.sinListas} description={TEXTOS.ayudaGeneral} />}

      {listas?.map((l) => (
        <article key={l.id} className="flex flex-col gap-3 rounded-[var(--radius)] border p-4" style={{ borderColor: "var(--line)" }}>
          <header className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{l.nombre}</h3>
            <span className="text-sm tabular-nums">× {fmtCoef(l.coeficiente)}</span>
            {l.esReferencia && <Badge tone="info">{TEXTOS.listas.referencia}</Badge>}
            {!l.activa && <Badge tone="neutral">{TEXTOS.listas.inactiva}</Badge>}
            <span className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => setForm({ id: l.id, nombre: l.nombre, coeficiente: fmtCoef(l.coeficiente), orden: String(l.orden) })}>
              {TEXTOS.listas.editar}
            </Button>
            {!l.esReferencia && l.activa && (
              <Button size="sm" variant="outline" onClick={() => pedirPrevia([{ op: "setReferencia", listaId: l.id }], TEXTOS.listas.marcarReferencia, l.nombre)}>
                {TEXTOS.listas.marcarReferencia}
              </Button>
            )}
            {!l.esReferencia && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => pedirPrevia([{ op: "editarLista", listaId: l.id, activa: !l.activa }], l.activa ? TEXTOS.listas.desactivar : TEXTOS.listas.activar, l.nombre)}
              >
                {l.activa ? TEXTOS.listas.desactivar : TEXTOS.listas.activar}
              </Button>
            )}
            {!l.esReferencia && (
              <Button size="sm" variant="danger" onClick={() => setConfirmarBaja(l)}>
                {TEXTOS.listas.eliminar}
              </Button>
            )}
          </header>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm" style={{ color: "var(--ink-soft)" }}>{TEXTOS.listas.ajustes}</h4>
              <Button size="sm" variant="ghost" onClick={() => setAjuste({ listaId: l.id, tipo: "marca", marca: "", categoriaId: "", coeficiente: "" })}>
                {TEXTOS.listas.nuevoAjuste}
              </Button>
            </div>
            {l.overrides.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--ink-faint)" }}>{TEXTOS.listas.sinAjustes}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {l.overrides.map((o) => (
                  <li key={o.id} className="flex items-center gap-2 text-sm">
                    <span>{o.tipo === "marca" ? `Marca ${o.marca}` : `Categoría ${o.categoriaNombre ?? ""}`}</span>
                    <span className="tabular-nums">× {fmtCoef(o.coeficiente)}</span>
                    <span className="flex-1" />
                    <Button size="sm" variant="ghost" onClick={() => pedirPrevia([{ op: "borrarOverride", overrideId: o.id }], TEXTOS.listas.quitarAjuste, l.nombre)}>
                      {TEXTOS.listas.quitarAjuste}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>
      ))}

      {config && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setAvanzados(true)}>
            <Settings size={14} aria-hidden="true" />
            {TEXTOS.listas.ajustesAvanzados}
          </Button>
        </div>
      )}

      <Dialog
        open={avanzados}
        onOpenChange={setAvanzados}
        title={TEXTOS.listas.ajustesAvanzados}
        description={TEXTOS.listas.umbralAyuda}
        dismissible={false}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAvanzados(false)}>{TEXTOS.listas.cerrar}</Button>
            <Button onClick={guardarUmbrales}>{TEXTOS.listas.revisarCambio}</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {/* Field.label del DS es solo texto: el ícono de información va junto al campo. */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label={TEXTOS.listas.umbralConfirmacion}>
                <Input inputMode="decimal" value={umbrales.confirmacion} onChange={(e) => setUmbrales((u) => ({ ...u, confirmacion: e.target.value }))} />
              </Field>
            </div>
            {info(TEXTOS.listas.umbralConfirmacionInfo)}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label={TEXTOS.listas.umbralRetencion}>
                <Input inputMode="decimal" value={umbrales.retencion} onChange={(e) => setUmbrales((u) => ({ ...u, retencion: e.target.value }))} />
              </Field>
            </div>
            {info(TEXTOS.listas.umbralRetencionInfo)}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={form !== null}
        onOpenChange={(v) => !v && setForm(null)}
        title={form?.id ? TEXTOS.listas.editar : TEXTOS.listas.nueva}
        dismissible={false}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setForm(null)}>{TEXTOS.listas.cancelar}</Button>
            <Button onClick={guardarLista}>{TEXTOS.listas.guardar}</Button>
          </div>
        }
      >
        {form && (
          <div className="flex flex-col gap-3">
            {errorForm && <Alert tone="danger">{errorForm}</Alert>}
            <Field label={TEXTOS.listas.nombre}>
              <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} maxLength={60} />
            </Field>
            <Field label={TEXTOS.listas.coeficiente} hint={TEXTOS.listas.coeficienteAyuda}>
              <Input inputMode="decimal" value={form.coeficiente} onChange={(e) => setForm({ ...form, coeficiente: e.target.value })} />
            </Field>
            <Field label={TEXTOS.listas.orden}>
              <Input inputMode="numeric" value={form.orden} onChange={(e) => setForm({ ...form, orden: e.target.value })} />
            </Field>
          </div>
        )}
      </Dialog>

      <Dialog
        open={ajuste !== null}
        onOpenChange={(v) => !v && setAjuste(null)}
        title={TEXTOS.listas.nuevoAjuste}
        description={TEXTOS.listas.ajustesAyuda}
        dismissible={false}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAjuste(null)}>{TEXTOS.listas.cancelar}</Button>
            <Button onClick={guardarAjuste}>{TEXTOS.listas.guardar}</Button>
          </div>
        }
      >
        {ajuste && (
          <div className="flex flex-col gap-3">
            <Field label="Tipo de ajuste">
              <Select
                value={ajuste.tipo}
                onValueChange={(v) => setAjuste({ ...ajuste, tipo: v as "marca" | "categoria" })}
                options={[
                  { value: "marca", label: TEXTOS.listas.ajusteMarca },
                  { value: "categoria", label: TEXTOS.listas.ajusteCategoria },
                ]}
              />
            </Field>
            {ajuste.tipo === "marca" ? (
              <Field label={TEXTOS.grilla.marca}>
                <Input value={ajuste.marca} onChange={(e) => setAjuste({ ...ajuste, marca: e.target.value })} maxLength={80} />
              </Field>
            ) : (
              <Field label={TEXTOS.grilla.categoria}>
                <Select
                  value={ajuste.categoriaId}
                  onValueChange={(v) => setAjuste({ ...ajuste, categoriaId: v })}
                  placeholder="Seleccione una categoría"
                  options={categorias.map((c) => ({ value: c.id, label: `${"— ".repeat(Math.max(0, c.nivel - 1))}${c.nombre}` }))}
                />
              </Field>
            )}
            <Field label={TEXTOS.listas.coeficiente} hint={TEXTOS.listas.coeficienteAyuda}>
              <Input inputMode="decimal" value={ajuste.coeficiente} onChange={(e) => setAjuste({ ...ajuste, coeficiente: e.target.value })} />
            </Field>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmarBaja !== null}
        onOpenChange={(v) => !v && setConfirmarBaja(null)}
        title={TEXTOS.listas.eliminar}
        description={confirmarBaja ? TEXTOS.listas.confirmarEliminar(confirmarBaja.nombre) : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmarBaja(null)}>{TEXTOS.listas.cancelar}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!confirmarBaja) return
                const l = confirmarBaja
                setConfirmarBaja(null)
                pedirPrevia([{ op: "borrarLista", listaId: l.id }], `${TEXTOS.listas.eliminar}: ${l.nombre}`, l.nombre)
              }}
            >
              {TEXTOS.listas.eliminar}
            </Button>
          </div>
        }
      />

      {previa && (
        <VistaPreviaDialog
          open
          onClose={() => setPrevia(null)}
          cambios={previa.cambios}
          titulo={previa.titulo}
          nombreParaConfirmar={previa.nombre}
          onAplicado={() => {
            setPrevia(null)
            void cargar()
            onCambio()
          }}
        />
      )}
    </section>
  )
}
