"use client"

import { useState } from "react"
import { AlertTriangle, Undo2 } from "lucide-react"
import { Alert, Button, Checkbox, Chip, Dialog, Field, Input, Select, Textarea } from "@myd-org/ui"
import {
  api,
  TEXTO_MOTIVO,
  ErrorApi,
  fmtFechaHora,
  precioDeLista,
  stockEnSucursal,
  type CategoriaDto,
  type FichaDto,
  type FotoDto,
  type ProductoDto,
  type Sincronizacion,
  type VarianteDto,
  type SucursalOpcionDto,
  type TagDto,
} from "./tipos"
import { AyudaTooltip } from "../AyudaTooltip"
import { AYUDA_VISIBLE_EN } from "./ayudas"
import { FotosProducto } from "./FotosProducto"
import { FichaTecnicaProducto } from "./FichaTecnicaProducto"
import { AtributosProducto } from "./AtributosProducto"
import { formularioDeOrden, ordenDeFormulario } from "./destacado"
import { ListaVariantes } from "./GrupoFila"
import { AVISO_MODELOS, esModelo, nombreDeVariante, textoCantidadVariantes } from "./variantes-ui"

interface Props {
  producto: ProductoDto
  categorias: CategoriaDto[]
  tags: TagDto[]
  /** Sucursales del tenant, para "Visible en" (el campo aparece solo con más de una). */
  sucursales: SucursalOpcionDto[]
  sincronizacion: Sincronizacion
  onCerrar: () => void
  onGuardado: (producto: ProductoDto) => void
  /** Alta de etiqueta en el momento, desde el selector del producto. */
  onTagCreado: (tag: TagDto) => void
}

/** Camino completo de la categoría ("Electricidad › Cables"), para no elegir a ciegas entre hermanas homónimas. */
export function caminoCategoria(categorias: CategoriaDto[], id: string): string {
  const porId = new Map(categorias.map((c) => [c.id, c]))
  const partes: string[] = []
  let cursor = porId.get(id)
  for (let i = 0; cursor && i < 5; i++) {
    partes.unshift(cursor.nombre)
    cursor = cursor.parentId ? porId.get(cursor.parentId) : undefined
  }
  return partes.join(" › ")
}

/** Radix reserva el string vacío en Select: con `""` la opción no se muestra. */
const SIN_CATEGORIA = "sin-categoria"

export function ProductoDialog({ producto, categorias, tags, sucursales, sincronizacion, onCerrar, onGuardado, onTagCreado }: Props) {
  const [nombre, setNombre] = useState(producto.nombre ?? "")
  const [descripcion, setDescripcion] = useState(producto.descripcion ?? "")
  const [categoriaId, setCategoriaId] = useState(producto.categoriaId ?? SIN_CATEGORIA)
  const [tagIds, setTagIds] = useState<string[]>(producto.tagIds)
  const [visible, setVisible] = useState(producto.visible)
  const [ocultoEn, setOcultoEn] = useState<string[]>(producto.ocultoEnSucursales)
  const [mostrarMarca, setMostrarMarca] = useState(producto.mostrarMarca)
  const formularioInicial = formularioDeOrden(producto.orden)
  const [destacado, setDestacado] = useState(formularioInicial.destacado)
  const [posicion, setPosicion] = useState(formularioInicial.posicion)
  const [errorPosicion, setErrorPosicion] = useState("")
  // Las fotos y la ficha técnica se guardan APARTE del resto de la ficha: cada cambio se
  // persiste solo, porque la subida ya ocurrió y perderla al cancelar el diálogo dejaría
  // objetos huérfanos en R2.
  const [fotos, setFotos] = useState(producto.fotos)
  const [fichaTecnica, setFichaTecnica] = useState<FichaDto | null>(producto.fichaTecnica)
  const [nuevoTag, setNuevoTag] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState("")

  const opcionesCategoria = [
    { value: SIN_CATEGORIA, label: "Sin clasificar" },
    ...categorias.map((c) => ({ value: c.id, label: caminoCategoria(categorias, c.id) })),
  ]

  async function guardar() {
    setError("")
    setErrorPosicion("")
    // Solo se manda `orden` si cambió la casilla o la posición: guardar otro dato no debe tocarlo.
    const cambioDestacado = destacado !== formularioInicial.destacado || posicion.trim() !== formularioInicial.posicion
    const orden = ordenDeFormulario({ destacado, posicion })
    if (cambioDestacado && !orden.ok) {
      setErrorPosicion(orden.error)
      return
    }
    setGuardando(true)
    try {
      const { producto: actualizado } = await api<{ producto: ProductoDto }>(
        `/api/admin/catalogo/productos/${encodeURIComponent(producto.alegraId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            nombre: nombre.trim() === "" ? null : nombre,
            descripcion: descripcion.trim() === "" ? null : descripcion,
            categoriaId: categoriaId === SIN_CATEGORIA ? null : categoriaId,
            visible,
            mostrarMarca,
            tagIds,
            ...(cambioDestacado && orden.ok ? { orden: orden.orden } : {}),
            // Solo se manda si el campo se mostró: con una sola sucursal no hay nada que elegir.
            ...(sucursales.length > 1 ? { ocultoEnSucursales: ocultoEn } : {}),
          }),
        },
      )
      onGuardado(actualizado)
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos guardar los cambios. Inténtelo nuevamente.")
    } finally {
      setGuardando(false)
    }
  }

  async function crearTag() {
    const texto = nuevoTag.trim()
    if (!texto) return
    try {
      const { tag } = await api<{ tag: TagDto }>("/api/admin/catalogo/tags", {
        method: "POST",
        body: JSON.stringify({ nombre: texto }),
      })
      onTagCreado(tag)
      setTagIds((prev) => [...prev, tag.id])
      setNuevoTag("")
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos crear la etiqueta.")
    }
  }

  const precio = precioDeLista(producto.prices)
  // Un modelo: el overlay de acá es el del GRUPO y lo heredan todas las variantes. El padre de Alegra
  // no tiene precio ni stock propios (se ven en cada variante) y no se vende.
  const modelo = esModelo(producto)
  const esPadre = producto.tipo === "padre"

  return (
    <Dialog
      dismissible={false}
      open
      size="lg"
      onOpenChange={(abierto) => {
        if (!abierto) onCerrar()
      }}
      title={producto.nombreEfectivo}
      description={modelo ? `Modelo · ${textoCantidadVariantes(producto.variantes.length)} · SKU ${producto.sku}` : `SKU ${producto.sku}`}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
            Última edición: {fmtFechaHora(producto.actualizadoEn)}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCerrar} disabled={guardando}>
              Cerrar
            </Button>
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <p className="rounded-[var(--radius)] p-2 text-sm" style={{ background: "var(--red-soft)", color: "var(--red)" }} role="alert">
            {error}
          </p>
        )}

        {modelo && <Alert tone="neutral">{AVISO_MODELOS}</Alert>}

        <PorQueNoSePublica producto={producto} sincronizacion={sincronizacion} />

        <div className="grid gap-4 md:grid-cols-2">
          {/* Izquierda: lo que manda Alegra. Sólo lectura, y se dice de dónde viene. */}
          <section className="flex flex-col gap-2 rounded-[var(--radius)] p-3" style={{ background: "var(--bg)" }}>
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-faint)" }}>
              Datos de Alegra (sólo lectura)
            </h3>
            <DatoAlegra etiqueta="Identificador" valor={producto.alegraId} />
            <DatoAlegra etiqueta="Código" valor={producto.code ?? "—"} />
            <DatoAlegra etiqueta="Nombre en Alegra" valor={producto.nombreAlegra} />
            <DatoAlegra etiqueta="Descripción en Alegra" valor={producto.descripcionAlegra ?? "—"} />
            {!esPadre && <DatoAlegra etiqueta="Precio de lista" valor={precio ?? "Sin precio"} />}
            {!esPadre && <DatoAlegra etiqueta="Stock" valor={producto.stock ?? "—"} />}
            {!esPadre && sucursales.length > 1 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
                  Stock por sucursal
                </span>
                {sucursales
                  .filter((s) => s.activa)
                  .map((s) => {
                    const st = stockEnSucursal(producto, s.slug)
                    return (
                      <DatoAlegra
                        key={s.slug}
                        etiqueta={s.nombre}
                        valor={st ? `${st.texto}${st.leidoAt ? ` (actualizado el ${fmtFechaHora(st.leidoAt)})` : ""}` : "Sin dato"}
                      />
                    )
                  })}
              </div>
            )}
            <DatoAlegra etiqueta="Estado" valor={producto.status === "active" ? "Activo" : "Inactivo"} />
            <DatoAlegra etiqueta="Última sincronización" valor={fmtFechaHora(producto.syncedAt)} />
            <p className="mt-1 text-xs" style={{ color: "var(--ink-faint)" }}>
              {esPadre
                ? "Este producto agrupa las variantes en Alegra y no se vende: el precio y el stock están en cada variante. Se administran en Alegra."
                : "El precio y el stock se administran en Alegra. Desde acá no se modifican."}
            </p>
          </section>

          {/* Derecha: lo editable. Cada campo muestra debajo el valor de Alegra y cómo volver a él. */}
          <section className="flex flex-col gap-3">
            <div>
              <Field label="Nombre para la tienda">
                <Input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder={nombreDeAlegra(producto)}
                />
              </Field>
              <ValorDeAlegra
                valor={nombreDeAlegra(producto)}
                usandoPropio={nombre.trim() !== ""}
                onVolver={() => setNombre("")}
              />
            </div>

            <div>
              <Field label="Descripción para la tienda">
                <Textarea
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  rows={3}
                  placeholder={producto.descripcionAlegra ?? "Sin descripción en Alegra"}
                />
              </Field>
              <ValorDeAlegra
                valor={producto.descripcionAlegra ?? "Sin descripción en Alegra"}
                usandoPropio={descripcion.trim() !== ""}
                onVolver={() => setDescripcion("")}
              />
            </div>

            <Field label="Categoría">
              <Select options={opcionesCategoria} value={categoriaId} onValueChange={setCategoriaId} />
            </Field>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
                Etiquetas
              </span>
              <div className="flex flex-wrap gap-1.5">
                {tags.length === 0 && (
                  <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
                    Todavía no hay etiquetas. Cree una acá abajo o desde la solapa Etiquetas.
                  </span>
                )}
                {tags.map((t) => {
                  const puesta = tagIds.includes(t.id)
                  return (
                    <Chip
                      key={t.id}
                      variant="toggle"
                      selected={puesta}
                      onClick={() => setTagIds((prev) => (puesta ? prev.filter((id) => id !== t.id) : [...prev, t.id]))}
                      aria-pressed={puesta}
                    >
                      {t.nombre}
                    </Chip>
                  )
                })}
              </div>
              <div className="flex gap-2">
                <Input
                  value={nuevoTag}
                  onChange={(e) => setNuevoTag(e.target.value)}
                  placeholder="Crear una etiqueta nueva"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      void crearTag()
                    }
                  }}
                />
                <Button variant="ghost" onClick={() => void crearTag()} disabled={nuevoTag.trim() === ""}>
                  Crear
                </Button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
              <Checkbox checked={visible} onCheckedChange={setVisible} aria-label={modelo ? "Publicar el modelo en la tienda" : "Publicar en la tienda"} />
              {modelo ? "Publicar el modelo en la tienda" : "Publicar en la tienda"}
            </label>

            <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
              <Checkbox checked={mostrarMarca} onCheckedChange={setMostrarMarca} aria-label="Mostrar la marca en la tienda" />
              Mostrar la marca en la tienda
            </label>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                <Checkbox checked={destacado} onCheckedChange={setDestacado} aria-label="Destacar en la categoría" />
                Destacar en la categoría
              </label>
              <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
                Se muestra primero en su categoría y en las categorías que la contienen.
              </p>
              {destacado && (
                <Field
                  label="Posición (opcional)"
                  hint="Un número menor se muestra antes. Sin posición, queda después de los que tienen una."
                  error={errorPosicion || undefined}
                >
                  <Input
                    value={posicion}
                    onChange={(e) => setPosicion(e.target.value)}
                    inputMode="numeric"
                    placeholder="Por ejemplo: 1"
                  />
                </Field>
              )}
            </div>

            {sucursales.length > 1 && (
              <VisibleEn sucursales={sucursales} ocultoEn={ocultoEn} onCambio={setOcultoEn} />
            )}
          </section>
        </div>

        {modelo && (
          <section className="flex flex-col gap-2">
            <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
              Variantes del modelo
            </span>
            <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
              Todas las variantes comparten el nombre, la descripción, la categoría, las etiquetas, la ficha y las fotos del
              modelo. Cada una conserva su propio precio y stock, y puede tener su foto propia. Para ocultar una variante,
              désela de baja en Alegra.
            </p>
            <ListaVariantes variantes={producto.variantes} extra={(v) => <FotoPropiaVariante variante={v} />} />
          </section>
        )}

        <FotosProducto
          alegraId={producto.alegraId}
          fotos={fotos}
          onCambio={setFotos}
          titulo={modelo ? "Fotos del modelo" : "Fotos del producto"}
        />

        <FichaTecnicaProducto alegraId={producto.alegraId} ficha={fichaTecnica} onCambio={setFichaTecnica} />

        {!esPadre && <AtributosProducto alegraId={producto.alegraId} tieneFicha={fichaTecnica !== null} />}
      </div>
    </Dialog>
  )
}

/**
 * Campo "Visible en": un check por sucursal ACTIVA, todas tildadas por defecto. Destildar una
 * agrega su slug a `oculto_en_sucursales`; destildar todas oculta el producto en todas. Un slug de
 * una sucursal dada de baja se conserva y se muestra "Sucursal inactiva" (no se puede tildar).
 */
export function VisibleEn({
  sucursales,
  ocultoEn,
  onCambio,
}: {
  sucursales: SucursalOpcionDto[]
  ocultoEn: string[]
  onCambio: (ocultoEn: string[]) => void
}) {
  const activas = sucursales.filter((s) => s.activa)
  const inactivasOcultas = sucursales.filter((s) => !s.activa && ocultoEn.includes(s.slug))
  const ocultoEnTodas = activas.length > 0 && activas.every((s) => ocultoEn.includes(s.slug))
  const alternar = (slug: string, visibleAhora: boolean) =>
    onCambio(visibleAhora ? ocultoEn.filter((s) => s !== slug) : [...new Set([...ocultoEn, slug])])

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 flex items-center gap-1 text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
        Visible en
        <AyudaTooltip etiqueta="Visible en" texto={AYUDA_VISIBLE_EN} />
      </legend>
      {activas.map((s) => {
        const visibleAhora = !ocultoEn.includes(s.slug)
        return (
          <label key={s.slug} className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
            <Checkbox
              checked={visibleAhora}
              onCheckedChange={(v) => alternar(s.slug, v === true)}
              aria-label={`Visible en ${s.nombre}`}
            />
            {s.nombre}
          </label>
        )
      })}
      {inactivasOcultas.map((s) => (
        <span key={s.slug} className="text-sm" style={{ color: "var(--ink-faint)" }}>
          {s.nombre}: Sucursal inactiva
        </span>
      ))}
      {ocultoEnTodas && (
        <p className="text-xs" role="status" style={{ color: "var(--amber)" }}>
          El producto quedará oculto en todas las sucursales.
        </p>
      )}
      <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
        Si oculta el producto en una sucursal, no se ofrecerá para retiro ni se despachará desde ella; su stock se sigue
        sincronizando.
      </p>
    </fieldset>
  )
}

// Lo que muestra la tienda sin nombre propio: el name de Alegra, salvo que sea el código (ahí la
// descripción). Misma regla que nombreEfectivo de lib/catalogo-overlay, que no se importa acá
// porque arrastra drizzle al bundle del cliente.
function nombreDeAlegra(producto: { nombreAlegra: string; descripcionAlegra: string | null; code: string | null }): string {
  const name = producto.nombreAlegra.trim().toUpperCase()
  const code = producto.code?.trim().toUpperCase()
  const esCodigo = !!name && !!code && (code === name || code.startsWith(`${name}-`))
  return (esCodigo ? producto.descripcionAlegra?.trim() || null : null) ?? producto.nombreAlegra
}

function DatoAlegra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-xs" style={{ color: "var(--ink-faint)" }}>
        {etiqueta}
      </span>
      <span className="truncate text-right" style={{ color: "var(--ink)" }} title={valor}>
        {valor}
      </span>
    </div>
  )
}

/** El valor que la tienda mostraría si el campo propio quedara vacío, con el atajo para volver a él. */
function ValorDeAlegra({ valor, usandoPropio, onVolver }: { valor: string; usandoPropio: boolean; onVolver: () => void }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 text-xs" style={{ color: "var(--ink-faint)" }}>
      <span className="truncate" title={valor}>
        En Alegra: {valor}
      </span>
      {usandoPropio && (
        <button
          type="button"
          onClick={onVolver}
          className="flex shrink-0 items-center gap-1 underline"
          style={{ color: "var(--ink-soft)" }}
        >
          <Undo2 size={12} /> Volver al de Alegra
        </button>
      )}
    </div>
  )
}

/** Lo mismo que TEXTO_MOTIVO, pero para un modelo: el precio y el estado en Alegra son los de sus variantes. */
const TEXTO_MOTIVO_MODELO: typeof TEXTO_MOTIVO = {
  oculto: "El modelo está oculto en la tienda. Puede publicarlo desde acá.",
  inactivo_en_alegra: "Todas las variantes están dadas de baja en Alegra. Mientras siga así, publicarlo no lo muestra en la tienda.",
  sin_precio: "Ninguna variante activa tiene precio en Alegra.",
}

/**
 * La foto propia de una variante (la que se muestra al elegir ese color). Se guarda aparte del resto
 * de la ficha, como las demás fotos, en el overlay de la variante. La base de un grupo armado a mano
 * no la tiene: sus fotos son las del modelo.
 */
function FotoPropiaVariante({ variante }: { variante: VarianteDto }) {
  const [abierto, setAbierto] = useState(false)
  const [fotos, setFotos] = useState<FotoDto[]>(variante.fotos)
  if (variante.esAncla) return null
  return (
    <div className="mt-2">
      <Button variant="ghost" size="sm" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        {abierto ? "Ocultar la foto propia" : fotos.length > 0 ? "Ver la foto propia" : "Agregar una foto propia"}
      </Button>
      {abierto && (
        <div className="mt-2">
          <FotosProducto
            alegraId={variante.alegraId}
            fotos={fotos}
            onCambio={setFotos}
            alcance="variante"
            titulo={`Foto propia: ${nombreDeVariante(variante)}`}
          />
        </div>
      )}
    </div>
  )
}

function PorQueNoSePublica({ producto, sincronizacion }: { producto: ProductoDto; sincronizacion: Sincronizacion }) {
  const publicado = producto.motivos.length === 0
  return (
    <section
      className="rounded-[var(--radius)] p-3 text-sm"
      style={{
        background: publicado ? "var(--green-soft)" : "var(--amber-soft)",
        border: `1px solid ${publicado ? "var(--green)" : "var(--amber)"}`,
        color: publicado ? "var(--green)" : "var(--amber)",
      }}
    >
      <div className="flex items-center gap-2 font-medium">
        {!publicado && <AlertTriangle size={15} strokeWidth={1.8} />}
        {publicado
          ? producto.tipo === "padre"
            ? "El modelo se publica en la tienda"
            : "Se publica en la tienda"
          : producto.tipo === "padre"
            ? "El modelo no se publica en la tienda"
            : "No se publica en la tienda"}
      </div>
      {!publicado && (
        <ul className="mt-1 list-disc pl-5">
          {producto.motivos.map((m) => (
            <li key={m}>{producto.tipo === "padre" ? TEXTO_MOTIVO_MODELO[m] : TEXTO_MOTIVO[m]}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs" style={{ color: "var(--ink-faint)" }}>
        Esta evaluación es orientativa: la tienda la vuelve a hacer con el precio y el stock de su propia sincronización
        con Alegra. Último aviso entregado a la tienda: {fmtFechaHora(sincronizacion.avisoShop.ultimoOkAt)}.
      </p>
    </section>
  )
}

