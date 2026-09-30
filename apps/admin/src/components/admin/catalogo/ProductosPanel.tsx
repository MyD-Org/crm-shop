"use client"

import { useCallback, useEffect, useState, type MouseEvent } from "react"
import { Check, Copy, Package, RefreshCw } from "lucide-react"
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  SearchInput,
  Select,
  SelectionBar,
  Table,
  useToast,
  type TableColumn,
} from "@myd-org/ui"
import { ProductoDialog, caminoCategoria } from "./ProductoDialog"
import { contarFotos } from "./FotosProducto"
import { SincronizarAlegra } from "./SincronizarAlegra"
import {
  api,
  TEXTO_MOTIVO,
  ErrorApi,
  fmtFechaHora,
  precioDeLista,
  queryDeFiltros,
  stockDe,
  stockEnSucursal,
  type CategoriaDto,
  type CuentaOrigenDto,
  type SucursalOpcionDto,
  type Filtros,
  type ListadoDto,
  type ProductoDto,
  type Seleccion,
  type TagDto,
} from "./tipos"

interface Props {
  categorias: CategoriaDto[]
  tags: TagDto[]
  /** Cuentas de Alegra del tenant; con más de una aparece el filtro "Cuenta". */
  cuentas: CuentaOrigenDto[]
  /** Sucursales del tenant; con más de una aparecen el filtro "Visible en" y el badge "Oculto en …". */
  sucursales: SucursalOpcionDto[]
  /** Búsqueda inicial (viene de "Ver en Productos" de la solapa Revisión). */
  busquedaInicial?: string
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

/** Filtros que no son la búsqueda: cuentan para "Limpiar filtros". */
const CLAVES_FILTRO = ["categoria", "estado", "foto", "alegra", "precio", "stock", "tag", "cuenta", "sucursal", "stockEn"] as const

/** SKU con un botón para copiarlo sin abrir el producto (la fila entera abre el diálogo). */
function Sku({ sku }: { sku: string }) {
  const { toast } = useToast()
  const [copiado, setCopiado] = useState(false)

  async function copiar(e: MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(sku)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      toast({ title: "No se pudo copiar el SKU", tone: "danger" })
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      SKU {sku}
      <Button
        variant="ghost"
        size="inline"
        onClick={(e) => void copiar(e)}
        aria-label={copiado ? "SKU copiado" : `Copiar el SKU ${sku}`}
        title={copiado ? "Copiado" : "Copiar SKU"}
      >
        {copiado ? <Check size={12} /> : <Copy size={12} />}
      </Button>
    </span>
  )
}

export function ProductosPanel({ categorias, tags, cuentas, sucursales, busquedaInicial, onTagCreado, onCambio }: Props) {
  const [filtros, setFiltros] = useState<Filtros>({
    estado: "oculto",
    foto: "con",
    alegra: "active",
    precio: "con",
    stock: "con",
  })
  const [busqueda, setBusqueda] = useState(busquedaInicial ?? "")
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

  const filtrosActivos = CLAVES_FILTRO.filter((k) => filtros[k] !== undefined).length

  function limpiarFiltros() {
    setFiltros((prev) => (prev.q ? { q: prev.q } : {}))
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

  const hayVariasCuentas = cuentas.length > 1
  const hayVariasSucursales = sucursales.length > 1
  const nombreSucursal = (slug: string) => sucursales.find((s) => s.slug === slug)?.nombre ?? slug
  // Manda el nombre de la SUCURSAL asignada a la cuenta: el de la cuenta puede haber quedado viejo.
  const nombreDeCuenta = (c: CuentaOrigenDto) => c.sucursal ?? c.nombre
  const nombreCuentaPrincipal = nombreDeCuenta(cuentas.find((c) => c.principal) ?? { slug: "", nombre: "Principal", principal: true })
  const sucursalesActivas = sucursales.filter((s) => s.activa)

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
            <Sku sku={p.sku} />
          </div>
          {(p.cuenta || (hayVariasSucursales && p.ocultoEnSucursales.length > 0)) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {p.cuenta && <Badge tone="info">Solo en {p.cuenta.sucursal ?? p.cuenta.nombre}</Badge>}
              {hayVariasSucursales &&
                p.ocultoEnSucursales.map((slug) => (
                  <Badge key={slug} tone="warning">
                    Oculto en {nombreSucursal(slug)}
                  </Badge>
                ))}
            </div>
          )}
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
    ...(hayVariasCuentas
      ? [
          {
            key: "cuenta",
            header: "Cuenta de origen",
            hideBelow: "lg",
            render: (p: ProductoDto) => (
              <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                {p.cuenta ? (p.cuenta.sucursal ?? p.cuenta.nombre) : nombreCuentaPrincipal}
              </span>
            ),
          } satisfies TableColumn<ProductoDto>,
        ]
      : []),
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
      key: "stock",
      header: "Stock",
      align: "right",
      hideBelow: "sm",
      className: "tabular-nums text-xs",
      render: (p) => {
        const s = stockDe(p.stock)
        return (
          <>
            <div style={{ color: s?.hay ? "var(--ink-soft)" : "var(--ink-faint)" }}>{s ? s.texto : "Sin dato"}</div>
            {hayVariasSucursales && (
              <div className="whitespace-nowrap" style={{ color: "var(--ink-faint)" }}>
                {sucursalesActivas
                  .map((suc) => `${suc.nombre} ${stockEnSucursal(p, suc.slug)?.texto ?? "—"}`)
                  .join(" · ")}
              </div>
            )}
          </>
        )
      },
    },
    {
      key: "fotos",
      header: "Fotos",
      align: "center",
      hideBelow: "md",
      render: (p) =>
        p.fotos.length > 0 ? (
          <Badge tone="neutral">{contarFotos(p.fotos)}</Badge>
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
        <div className="min-w-0 w-full sm:max-w-[420px] sm:flex-1">
          <SearchInput
            className="w-full"
            value={busqueda}
            onValueChange={setBusqueda}
            onClear={() => setBusqueda("")}
            placeholder="Busque por nombre o por código"
            aria-label="Buscar productos"
          />
        </div>
        {filtrosActivos > 0 && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={limpiarFiltros}>
            Limpiar filtros ({filtrosActivos})
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
        <Select
          aria-label="Filtrar por categoría"
          value={filtros.categoria ?? TODOS}
          onValueChange={(v) => cambiarFiltro("categoria", v)}
          options={[
            { value: TODOS, label: "Categoría: todas" },
            { value: "sin", label: "Categoría: sin clasificar" },
            ...categorias.map((c) => ({ value: c.id, label: `Categoría: ${caminoCategoria(categorias, c.id)}` })),
          ]}
        />
        <Select
          aria-label="Filtrar por estado"
          value={filtros.estado ?? TODOS}
          onValueChange={(v) => cambiarFiltro("estado", v)}
          options={[
            { value: TODOS, label: "Tienda: todos" },
            { value: "visible", label: "Tienda: publicados" },
            { value: "oculto", label: "Tienda: ocultos" },
          ]}
        />
        <Select
          aria-label="Filtrar por fotos"
          value={filtros.foto ?? TODOS}
          onValueChange={(v) => cambiarFiltro("foto", v)}
          options={[
            { value: TODOS, label: "Fotos: todos" },
            { value: "con", label: "Fotos: con foto" },
            { value: "sin", label: "Fotos: sin foto" },
          ]}
        />
        <Select
          aria-label="Filtrar por estado en Alegra"
          value={filtros.alegra ?? TODOS}
          onValueChange={(v) => cambiarFiltro("alegra", v)}
          options={[
            { value: TODOS, label: "Alegra: todos" },
            { value: "active", label: "Alegra: activos" },
            { value: "inactive", label: "Alegra: de baja" },
          ]}
        />
        <Select
          aria-label="Filtrar por precio"
          value={filtros.precio ?? TODOS}
          onValueChange={(v) => cambiarFiltro("precio", v)}
          options={[
            { value: TODOS, label: "Precio: todos" },
            { value: "con", label: "Precio: con precio" },
            { value: "sin", label: "Precio: sin precio" },
          ]}
        />
        <Select
          aria-label="Filtrar por stock"
          value={filtros.stock ?? TODOS}
          onValueChange={(v) => cambiarFiltro("stock", v)}
          options={[
            { value: TODOS, label: "Stock: todos" },
            { value: "con", label: "Stock: con stock" },
            { value: "sin", label: "Stock: sin stock" },
          ]}
        />
        {hayVariasCuentas && (
          <Select
            aria-label="Filtrar por cuenta de origen"
            value={filtros.cuenta ?? TODOS}
            onValueChange={(v) => cambiarFiltro("cuenta", v)}
            options={[
              { value: TODOS, label: "Cuenta de origen: todas" },
              { value: "principal", label: `Cuenta de origen: ${nombreCuentaPrincipal} (incluye repetidos)` },
              ...cuentas
                .filter((c) => !c.principal)
                .map((c) => ({ value: c.slug, label: `Cuenta de origen: existen solo en ${nombreDeCuenta(c)}` })),
            ]}
          />
        )}
        {hayVariasSucursales && (
          <Select
            aria-label="Filtrar por sucursal donde se ofrece el producto"
            value={filtros.sucursal ?? TODOS}
            onValueChange={(v) => cambiarFiltro("sucursal", v)}
            options={[
              { value: TODOS, label: "Visible en: todas" },
              ...sucursales.map((s) => ({ value: `visible:${s.slug}`, label: `Visible en: ${s.nombre}` })),
              ...sucursales.map((s) => ({ value: `oculto:${s.slug}`, label: `Oculto en: ${s.nombre}` })),
            ]}
          />
        )}
        {hayVariasSucursales && (
          <Select
            aria-label="Filtrar por sucursal con stock"
            value={filtros.stockEn ?? TODOS}
            onValueChange={(v) => cambiarFiltro("stockEn", v)}
            options={[
              { value: TODOS, label: "Con stock en: todas" },
              ...sucursalesActivas.map((s) => ({ value: s.slug, label: `Con stock en ${s.nombre}` })),
            ]}
          />
        )}
        <Select
          aria-label="Filtrar por etiqueta"
          value={filtros.tag ?? TODOS}
          onValueChange={(v) => cambiarFiltro("tag", v)}
          options={[
            { value: TODOS, label: "Etiqueta: todas" },
            ...tags.map((t) => ({ value: t.id, label: `Etiqueta: ${t.nombre}` })),
          ]}
        />
      </div>

      {(hayVariasCuentas || hayVariasSucursales) && (
        <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
          {hayVariasCuentas &&
            "«Cuenta de origen: existen solo en …» muestra los productos que están únicamente en esa cuenta, no los que tienen stock allí. "}
          {hayVariasSucursales &&
            "Para ver los productos con stock en una sucursal use «Con stock en»; «Visible en» y «Oculto en» indican dónde se ofrece cada producto en la tienda."}
        </p>
      )}

      {datos && (
        <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
          Última sincronización con Alegra: {fmtFechaHora(datos.sincronizacion.alegra)} · Último aviso entregado a la
          tienda: {fmtFechaHora(datos.sincronizacion.avisoShop.ultimoOkAt)}
        </p>
      )}

      <SincronizarAlegra onTerminado={() => void cargar()} />

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
          sucursales={sucursales}
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
