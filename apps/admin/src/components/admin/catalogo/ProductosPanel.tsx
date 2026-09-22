"use client"

import { useCallback, useEffect, useState } from "react"
import { Package, RefreshCw } from "lucide-react"
import { Badge, Button, Dialog, EmptyState, SearchInput, Select, SelectionBar, Table, type TableColumn } from "@myd-org/ui"
import { ProductoDialog, caminoCategoria } from "./ProductoDialog"
import {
  api,
  TEXTO_MOTIVO,
  ErrorApi,
  fmtFechaHora,
  precioDeLista,
  queryDeFiltros,
  type CategoriaDto,
  type Filtros,
  type ListadoDto,
  type ProductoDto,
  type Seleccion,
  type TagDto,
} from "./tipos"

interface Props {
  categorias: CategoriaDto[]
  tags: TagDto[]
  onTagCreado: (tag: TagDto) => void
  onCambio: () => void
}

const PAGINA = 50

type Accion =
  | { tipo: "visible"; valor: boolean }
  | { tipo: "categoria"; categoriaId: string | null }
  | { tipo: "tag"; tagId: string; modo: "agregar" | "quitar" }

interface Pendiente {
  accion: Accion
  seleccion: Seleccion
  afectados: number
  texto: string
}

/**
 * El `Select` del design system es Radix, que RESERVA el string vacío: un ítem con `value=""`
 * no es válido y `value=""` significa "sin selección". Con `""` como centinela de "sin filtrar",
 * los cinco filtros se renderizaban mudos. Por eso el centinela es un valor real.
 */
const TODOS = "todos"

/** Sin ancho propio cada filtro se lleva un renglón entero. */
const ANCHO_FILTRO = "w-[190px]"

export function ProductosPanel({ categorias, tags, onTagCreado, onCambio }: Props) {
  const [filtros, setFiltros] = useState<Filtros>({})
  const [busqueda, setBusqueda] = useState("")
  const [start, setStart] = useState(0)
  const [datos, setDatos] = useState<ListadoDto | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState("")
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [todoElFiltro, setTodoElFiltro] = useState(false)
  const [abierto, setAbierto] = useState<ProductoDto | null>(null)
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [aplicando, setAplicando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = queryDeFiltros(filtros)
      params.set("start", String(start))
      params.set("limit", String(PAGINA))
      setDatos(await api<ListadoDto>(`/api/admin/catalogo/productos?${params.toString()}`))
      setError("")
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos cargar el catálogo.")
    } finally {
      setCargando(false)
    }
  }, [filtros, start])

  useEffect(() => {
    void (async () => {
      await cargar()
    })()
  }, [cargar])

  // La búsqueda por texto se aplica con un respiro: cada tecla no dispara una consulta.
  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((prev) => (prev.q === busqueda.trim() ? prev : { ...prev, q: busqueda.trim() }))
      setStart(0)
    }, 350)
    return () => clearTimeout(t)
  }, [busqueda])

  function cambiarFiltro(clave: keyof Filtros, valor: string) {
    setFiltros((prev) => {
      const next = { ...prev }
      if (valor === TODOS) delete next[clave]
      else Object.assign(next, { [clave]: valor })
      return next
    })
    setStart(0)
    setSeleccion([])
    setTodoElFiltro(false)
  }

  /**
   * Antes de aplicar, el servidor cuenta cuántos productos alcanza la selección: es el número
   * que dice la confirmación. El cliente no lo puede calcular cuando la selección es "todo lo
   * que coincide con el filtro" (pueden ser miles), y el conjunto puede haber cambiado si la
   * sincronización con Alegra corrió en el medio.
   */
  async function preparar(accion: Accion, texto: (n: number) => string) {
    const sel: Seleccion = todoElFiltro ? { tipo: "filtro", filtros } : { tipo: "ids", alegraIds: seleccion }
    try {
      const { afectados } = await api<{ afectados: number }>("/api/admin/catalogo/productos/masiva/contar", {
        method: "POST",
        body: JSON.stringify({ seleccion: sel }),
      })
      setPendiente({ accion, seleccion: sel, afectados, texto: texto(afectados) })
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos preparar la acción.")
    }
  }

  async function aplicar() {
    if (!pendiente) return
    setAplicando(true)
    try {
      await api("/api/admin/catalogo/productos/masiva", {
        method: "POST",
        body: JSON.stringify({ seleccion: pendiente.seleccion, accion: pendiente.accion }),
      })
      setPendiente(null)
      setSeleccion([])
      setTodoElFiltro(false)
      await cargar()
      onCambio()
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos aplicar la acción. No se modificó ningún producto.")
      setPendiente(null)
    } finally {
      setAplicando(false)
    }
  }

  const items = datos?.items ?? []
  const total = datos?.total ?? 0
  const hasta = Math.min(start + items.length, total)
  const seleccionados = todoElFiltro ? total : seleccion.length

  const columns: TableColumn<ProductoDto>[] = [
    {
      key: "producto",
      header: "Producto",
      render: (p) => (
        <>
          <div className="font-medium" style={{ color: "var(--ink)" }}>
            {p.nombreEfectivo}
          </div>
          <div className="text-xs" style={{ color: "var(--ink-faint)" }}>
            SKU {p.sku}
            {p.nombre === null && " · sin nombre propio"}
          </div>
        </>
      ),
    },
    {
      key: "categoria",
      header: "Categoría",
      hideBelow: "md",
      render: (p) => (
        <span className="text-xs" style={{ color: p.categoriaId ? "var(--ink-soft)" : "var(--ink-faint)" }}>
          {p.categoriaId ? caminoCategoria(categorias, p.categoriaId) : "Sin clasificar"}
        </span>
      ),
    },
    {
      key: "precio",
      header: "Precio",
      align: "right",
      hideBelow: "sm",
      className: "tabular-nums text-xs",
      render: (p) => (
        <span style={{ color: "var(--ink-soft)" }}>{precioDeLista(p.prices) ?? "Sin precio"}</span>
      ),
    },
    {
      key: "fotos",
      header: "Fotos",
      align: "center",
      hideBelow: "md",
      render: (p) =>
        p.fotos.length > 0 ? (
          <Badge tone="neutral">{p.fotos.length}</Badge>
        ) : (
          <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
            Sin foto
          </span>
        ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (p) =>
        p.motivos.length === 0 ? (
          <Badge tone="success">Publicado</Badge>
        ) : (
          <span title={p.motivos.map((m) => TEXTO_MOTIVO[m]).join(" ")}>
            <Badge tone={p.visible ? "warning" : "neutral"}>{p.visible ? "No se publica" : "Oculto"}</Badge>
          </span>
        ),
    },
    {
      key: "acciones",
      header: "",
      align: "right",
      render: (p) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            setAbierto(p)
          }}
        >
          Editar
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] max-w-[320px] flex-1">
          <SearchInput
            value={busqueda}
            onValueChange={setBusqueda}
            onClear={() => setBusqueda("")}
            placeholder="Busque por nombre o por código"
            aria-label="Buscar productos"
          />
        </div>
        <Select
          className={ANCHO_FILTRO}
          aria-label="Filtrar por categoría"
          value={filtros.categoria ?? TODOS}
          onValueChange={(v) => cambiarFiltro("categoria", v)}
          options={[
            { value: TODOS, label: "Todas las categorías" },
            { value: "sin", label: "Sin clasificar" },
            ...categorias.map((c) => ({ value: c.id, label: caminoCategoria(categorias, c.id) })),
          ]}
        />
        <Select
          className={ANCHO_FILTRO}
          aria-label="Filtrar por estado"
          value={filtros.estado ?? TODOS}
          onValueChange={(v) => cambiarFiltro("estado", v)}
          options={[
            { value: TODOS, label: "Publicados y ocultos" },
            { value: "visible", label: "Publicados" },
            { value: "oculto", label: "Ocultos" },
          ]}
        />
        <Select
          className={ANCHO_FILTRO}
          aria-label="Filtrar por fotos"
          value={filtros.foto ?? TODOS}
          onValueChange={(v) => cambiarFiltro("foto", v)}
          options={[
            { value: TODOS, label: "Con y sin foto" },
            { value: "sin", label: "Sin foto" },
            { value: "con", label: "Con foto" },
          ]}
        />
        <Select
          className={ANCHO_FILTRO}
          aria-label="Filtrar por estado en Alegra"
          value={filtros.alegra ?? TODOS}
          onValueChange={(v) => cambiarFiltro("alegra", v)}
          options={[
            { value: TODOS, label: "Activos y de baja" },
            { value: "active", label: "Activos en Alegra" },
            { value: "inactive", label: "De baja en Alegra" },
          ]}
        />
        <Select
          className={ANCHO_FILTRO}
          aria-label="Filtrar por precio"
          value={filtros.precio ?? TODOS}
          onValueChange={(v) => cambiarFiltro("precio", v)}
          options={[
            { value: TODOS, label: "Con y sin precio" },
            { value: "sin", label: "Sin precio" },
          ]}
        />
        <Select
          className={ANCHO_FILTRO}
          aria-label="Filtrar por stock"
          value={filtros.stock ?? TODOS}
          onValueChange={(v) => cambiarFiltro("stock", v)}
          options={[
            { value: TODOS, label: "Con y sin stock" },
            { value: "con", label: "Con stock" },
            { value: "sin", label: "Sin stock" },
          ]}
        />
        <Select
          className={ANCHO_FILTRO}
          aria-label="Filtrar por etiqueta"
          value={filtros.tag ?? TODOS}
          onValueChange={(v) => cambiarFiltro("tag", v)}
          options={[{ value: TODOS, label: "Todas las etiquetas" }, ...tags.map((t) => ({ value: t.id, label: t.nombre }))]}
        />
      </div>

      {datos && (
        <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
          Última sincronización con Alegra: {fmtFechaHora(datos.sincronizacion.alegra)} · Último aviso entregado a la
          tienda: {fmtFechaHora(datos.sincronizacion.avisoShop.ultimoOkAt)}
        </p>
      )}

      {error && (
        <div
          className="flex items-center justify-between gap-2 rounded-[var(--radius)] p-3 text-sm"
          style={{ background: "var(--red-soft)", color: "var(--red)" }}
          role="alert"
        >
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void cargar()}>
            <RefreshCw size={13} /> Reintentar
          </Button>
        </div>
      )}

      {seleccionados > 0 && (
        <SelectionBar
          count={seleccionados}
          label={todoElFiltro ? `${total} productos (todos los que coinciden con el filtro)` : undefined}
          summary={
            !todoElFiltro && seleccion.length === items.length && total > items.length ? (
              <button type="button" className="underline" onClick={() => setTodoElFiltro(true)}>
                Seleccionar los {total} que coinciden con el filtro
              </button>
            ) : undefined
          }
          onClear={() => {
            setSeleccion([])
            setTodoElFiltro(false)
          }}
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void preparar({ tipo: "visible", valor: true }, (n) => `Va a publicar ${n} producto${n === 1 ? "" : "s"} en la tienda.`)}
          >
            Publicar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void preparar({ tipo: "visible", valor: false }, (n) => `Va a ocultar ${n} producto${n === 1 ? "" : "s"} de la tienda.`)}
          >
            Ocultar
          </Button>
          <Select
            aria-label="Asignar categoría a la selección"
            value=""
            placeholder="Asignar categoría"
            options={[
              { value: "sin", label: "Sin clasificar" },
              ...categorias.map((c) => ({ value: c.id, label: caminoCategoria(categorias, c.id) })),
            ]}
            onValueChange={(v) =>
              void preparar({ tipo: "categoria", categoriaId: v === "sin" ? null : v }, (n) =>
                v === "sin"
                  ? `Va a quitarle la categoría a ${n} producto${n === 1 ? "" : "s"}.`
                  : `Va a asignar la categoría "${caminoCategoria(categorias, v)}" a ${n} producto${n === 1 ? "" : "s"}.`,
              )
            }
          />
          {tags.length > 0 && (
            <Select
              aria-label="Asignar etiqueta a la selección"
              value=""
              placeholder="Asignar etiqueta"
              options={tags.map((t) => ({ value: t.id, label: t.nombre }))}
              onValueChange={(v) =>
                void preparar({ tipo: "tag", tagId: v, modo: "agregar" }, (n) => {
                  const nombre = tags.find((t) => t.id === v)?.nombre ?? ""
                  return `Va a asignar la etiqueta "${nombre}" a ${n} producto${n === 1 ? "" : "s"}.`
                })
              }
            />
          )}
        </SelectionBar>
      )}

      {!cargando && items.length === 0 ? (
        <EmptyState
          icon={<Package size={28} strokeWidth={1.2} />}
          title="No hay productos que coincidan"
          description="Modifique o quite alguno de los filtros para ver más resultados."
        />
      ) : (
        <>
          <Table<ProductoDto>
            columns={columns}
            rows={items}
            rowKey={(p) => p.alegraId}
            selectable
            selectedKeys={todoElFiltro ? items.map((p) => p.alegraId) : seleccion}
            onSelectionChange={(keys) => {
              setTodoElFiltro(false)
              setSeleccion(keys)
            }}
            onRowClick={(p) => setAbierto(p)}
            empty="No hay productos para mostrar"
          />
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setStart(Math.max(0, start - PAGINA))} disabled={cargando || start === 0}>
              Anterior
            </Button>
            <p className="text-xs tabular-nums" style={{ color: "var(--ink-faint)" }}>
              {cargando ? "Cargando…" : total === 0 ? "0" : `${start + 1}–${hasta} de ${total}`}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setStart(start + PAGINA)} disabled={cargando || hasta >= total}>
              Siguiente
            </Button>
          </div>
        </>
      )}

      {abierto && (
        <ProductoDialog
          producto={abierto}
          categorias={categorias}
          tags={tags}
          sincronizacion={datos?.sincronizacion ?? { alegra: null, avisoShop: { ultimoOkAt: null, ultimoIntentoAt: null } }}
          onCerrar={() => setAbierto(null)}
          onTagCreado={onTagCreado}
          onGuardado={(actualizado) => {
            setDatos((prev) =>
              prev ? { ...prev, items: prev.items.map((p) => (p.alegraId === actualizado.alegraId ? actualizado : p)) } : prev,
            )
            setAbierto(null)
            onCambio()
          }}
        />
      )}

      {pendiente && (
        <Dialog
          open
          size="sm"
          onOpenChange={(abiertoDialog) => {
            if (!abiertoDialog) setPendiente(null)
          }}
          title="Confirme la acción"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendiente(null)} disabled={aplicando}>
                Cancelar
              </Button>
              <Button onClick={() => void aplicar()} disabled={aplicando}>
                {aplicando ? "Aplicando…" : "Confirmar"}
              </Button>
            </div>
          }
        >
          <p className="text-sm" style={{ color: "var(--ink)" }}>
            {pendiente.texto}
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--ink-faint)" }}>
            La acción se aplica a todos los productos alcanzados o a ninguno.
          </p>
        </Dialog>
      )}
    </div>
  )
}
