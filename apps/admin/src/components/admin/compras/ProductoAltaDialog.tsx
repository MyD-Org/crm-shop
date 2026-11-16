"use client"

import { useEffect, useRef, useState } from "react"
import { Alert, Button, Dialog, Field, Input, Select, Spinner } from "@myd-org/ui"
import { IVA_SOPORTADOS } from "@/lib/compras-entrada"
import { precioDesdePorcentaje, porcentajeDesdePrecio } from "@/lib/compras-listas-precio"

// «Crear producto» y «Copiar a <cuenta>» desde Nueva compra (change `compras-en-transito`, S4b).
// Tres pasos: datos (sólo al crear) -> precios por lista (% sobre el costo y precio NETO, editables
// los dos) -> confirmación explícita. Nada se escribe en Alegra hasta «Confirmar y crear».

export interface ProductoAgregable {
  alegraId: string
  nombre: string
  codigo: string | null
  marca: string | null
  ivaPorcentaje: number | null
  costoReferencia: number | null
}

export type ModoAlta = { tipo: "crear"; nombreInicial: string } | { tipo: "copiar"; producto: ProductoAgregable }

interface FilaLista {
  id: string
  nombre: string
  porcentajeDefecto: number
  porcentaje: string
  precio: string
}

type Paso = "datos" | "precios" | "confirmar"

const UNIDADES = [
  { label: "Unidad", value: "unit" },
  { label: "Kilogramo", value: "kg" },
  { label: "Metro", value: "m" },
  { label: "Litro", value: "l" },
]
const OPCIONES_IVA = IVA_SOPORTADOS.map((v) => ({ label: `${v} %`, value: String(v) }))

type ListaApi = { id: string; nombre: string; porcentajeDefecto: number; porcentaje: number; precio: number }
const aFilas = (listas: ListaApi[]): FilaLista[] =>
  listas.map((l) => ({ id: l.id, nombre: l.nombre, porcentajeDefecto: l.porcentajeDefecto, porcentaje: String(l.porcentaje), precio: l.precio.toFixed(2) }))

const num = (s: string) => Number(s.replace(",", "."))
const fmt = (n: number) => (Number.isFinite(n) ? String(n) : "")

export function ProductoAltaDialog({
  modo,
  cuenta,
  nombreCuenta,
  proveedorId = "",
  open,
  onOpenChange,
  onListo,
}: {
  modo: ModoAlta
  cuenta: string
  nombreCuenta: string
  /** Proveedor de la compra (para sugerir la marca por compras previas). */
  proveedorId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Producto ya disponible en el catálogo para agregarlo a la compra. */
  onListo: (p: ProductoAgregable, itemIdCuenta: string) => void
}) {
  const copiar = modo.tipo === "copiar"
  const [paso, setPaso] = useState<Paso>(copiar ? "precios" : "datos")
  const [nombre, setNombre] = useState(modo.tipo === "crear" ? modo.nombreInicial : "")
  const [codigo, setCodigo] = useState("")
  const [marca, setMarca] = useState("")
  const [sufijo, setSufijo] = useState("")
  const [unidad, setUnidad] = useState("unit")
  const [iva, setIva] = useState("21")
  const [costo, setCosto] = useState("")
  const [filas, setFilas] = useState<FilaLista[]>([])
  const [cargando, setCargando] = useState(copiar)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [categoriaId, setCategoriaId] = useState<string | null>(null)
  // Campos que el operador tocó (no se pisan con sugerencias) y campos hoy sugeridos.
  const tocados = useRef(new Set<string>())
  const [sugeridos, setSugeridos] = useState<Record<string, string>>({})

  const costoNum = copiar ? (modo.producto.costoReferencia ?? NaN) : num(costo)
  const referencia = `${codigo.trim()}-${sufijo.trim().toUpperCase()}`

  async function cargarListas() {
    setCargando(true)
    setError(null)
    try {
      const q = copiar
        ? `alegraId=${encodeURIComponent(modo.producto.alegraId)}`
        : `costo=${encodeURIComponent(String(costoNum))}`
      const res = await fetch(`/api/admin/compras/productos/alta?cuenta=${encodeURIComponent(cuenta)}&${q}`, { cache: "no-store" })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? "No se pudieron cargar las listas de precio. Inténtelo nuevamente.")
        return false
      }
      setFilas(aFilas(json.listas))
      return true
    } catch {
      setError("Error de conexión. Inténtelo nuevamente.")
      return false
    } finally {
      setCargando(false)
    }
  }

  // «Copiar»: las listas se piden al abrir (el diálogo se monta sólo al abrirse).
  useEffect(() => {
    if (!copiar) return
    let vivo = true
    fetch(`/api/admin/compras/productos/alta?cuenta=${encodeURIComponent(cuenta)}&alegraId=${encodeURIComponent(modo.producto.alegraId)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null)
        if (!vivo) return
        if (!res.ok) setError(json?.error ?? "No se pudieron cargar las listas de precio. Inténtelo nuevamente.")
        else setFilas(aFilas(json.listas))
      })
      .catch(() => vivo && setError("Error de conexión. Inténtelo nuevamente."))
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [copiar, cuenta, modo])

  async function pedirSugerencias(marcaActual: string) {
    try {
      const q = new URLSearchParams({ cuenta, texto: modo.tipo === "crear" ? modo.nombreInicial : "", marca: marcaActual, proveedor: proveedorId })
      const res = await fetch(`/api/admin/compras/productos/sugerencias?${q}`, { cache: "no-store" })
      if (!res.ok) return
      const s = (await res.json()) as {
        marca: string | null
        marcaEsSugerida: boolean
        sufijo: string | null
        sufijoEsNuevo: boolean
        categoriaId: string | null
        ivaPorcentaje: number | null
        nombre: string
        nombreSoloCodigo: boolean
        codigo: string | null
      }
      const marcas: Record<string, string> = {}
      const libre = (c: string) => !tocados.current.has(c)
      if (libre("marca") && s.marca && s.marcaEsSugerida) {
        setMarca(s.marca)
        marcas.marca = "sugerido"
      }
      if (libre("sufijo") && s.sufijo) {
        setSufijo(s.sufijo)
        marcas.sufijo = s.sufijoEsNuevo ? "nuevo, revíselo" : "sugerido"
      }
      if (libre("iva") && s.ivaPorcentaje !== null && (IVA_SOPORTADOS as readonly number[]).includes(s.ivaPorcentaje)) {
        setIva(String(s.ivaPorcentaje))
        marcas.iva = "sugerido"
      }
      if (libre("codigo") && s.codigo) {
        setCodigo(s.codigo)
        marcas.codigo = "sugerido"
      }
      if (libre("nombre") && s.nombre) {
        setNombre(s.nombre)
        marcas.nombre = s.nombreSoloCodigo ? "sugerido: parece un código, escriba el nombre del producto" : "sugerido"
      }
      setCategoriaId(s.categoriaId)
      setSugeridos((a) => ({ ...a, ...marcas }))
    } catch {
      // Las sugerencias son opcionales: sin ellas el formulario se completa a mano.
    }
  }

  // «Crear»: al abrir se piden las sugerencias a partir de lo que escribió el operador.
  useEffect(() => {
    if (copiar) return
    const t = setTimeout(() => void pedirSugerencias(""), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function tocar(campo: string) {
    tocados.current.add(campo)
    setSugeridos((a) => {
      const resto = { ...a }
      delete resto[campo]
      return resto
    })
  }

  function validarDatos(): string | null {
    if (!nombre.trim()) return "Indique el nombre del producto."
    if (!codigo.trim()) return "Indique el código del proveedor."
    if (/\s/.test(codigo.trim())) return "El código del proveedor no puede contener espacios."
    if (!marca.trim()) return "Indique la marca."
    if (!/^[A-Za-z0-9]{1,12}$/.test(sufijo.trim())) return "Indique el sufijo de la marca (letras y números, hasta 12 caracteres)."
    if (!Number.isFinite(costoNum) || costoNum <= 0) return "Indique un costo mayor a cero."
    return null
  }

  async function irAPrecios() {
    const e = validarDatos()
    if (e) {
      setError(e)
      return
    }
    if (await cargarListas()) setPaso("precios")
  }

  function editarPorcentaje(id: string, valor: string) {
    setFilas((l) =>
      l.map((f) => {
        if (f.id !== id) return f
        const p = num(valor)
        return { ...f, porcentaje: valor, precio: Number.isFinite(p) ? precioDesdePorcentaje(costoNum, p).toFixed(2) : f.precio }
      }),
    )
  }

  function editarPrecio(id: string, valor: string) {
    setFilas((l) =>
      l.map((f) => {
        if (f.id !== id) return f
        const p = num(valor)
        return { ...f, precio: valor, porcentaje: Number.isFinite(p) && p > 0 ? fmt(porcentajeDesdePrecio(costoNum, p)) : f.porcentaje }
      }),
    )
  }

  const preciosValidos = filas.length > 0 && filas.every((f) => Number.isFinite(num(f.precio)) && num(f.precio) > 0)
  const ajustadas = filas.filter((f) => Math.abs(num(f.porcentaje) - f.porcentajeDefecto) >= 0.005)

  async function confirmar() {
    setEnviando(true)
    setError(null)
    try {
      const precios = filas.map((f) => ({ id: f.id, precio: num(f.precio) }))
      const res = copiar
        ? await fetch("/api/admin/compras/productos/copiar", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cuenta, alegraId: modo.producto.alegraId, precios, confirmar: true }),
          })
        : await fetch("/api/admin/compras/productos/alta", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              cuenta,
              nombre: nombre.trim(),
              codigoProveedor: codigo.trim(),
              marca: marca.trim(),
              sufijoMarca: sufijo.trim().toUpperCase(),
              unidad,
              categoriaId,
              ivaPorcentaje: Number(iva),
              costo: costoNum,
              precios,
              confirmar: true,
            }),
          })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? "No se pudo crear el producto. Inténtelo nuevamente.")
        setPaso("precios")
        return
      }
      if (!json.espejado) {
        setAviso(
          "El producto se creó en Alegra, pero todavía no figura en el catálogo. Espere unos minutos y búsquelo por su código para agregarlo a la compra.",
        )
        return
      }
      const base = copiar
        ? modo.producto
        : { alegraId: json.alegraId, nombre: nombre.trim(), codigo: json.referencia ?? referencia, marca: marca.trim(), ivaPorcentaje: Number(iva), costoReferencia: costoNum }
      onListo({ ...base, alegraId: json.alegraId }, json.itemIdCuenta)
      onOpenChange(false)
    } catch {
      setError("Error de conexión. Inténtelo nuevamente.")
    } finally {
      setEnviando(false)
    }
  }

  const titulo = copiar ? `Copiar a ${nombreCuenta}` : "Crear producto"
  const nombreProducto = copiar ? modo.producto.nombre : nombre.trim()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={titulo}
      description={
        copiar
          ? `El producto existe en el catálogo pero no en la cuenta de ${nombreCuenta}.`
          : `El producto no existe en ninguna cuenta. Se creará en la cuenta de ${nombreCuenta}.`
      }
      dismissible={false}
      footer={
        aviso ? (
          <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => (paso === "confirmar" ? setPaso("precios") : paso === "precios" && !copiar ? setPaso("datos") : onOpenChange(false))} disabled={enviando}>
              {paso === "datos" || (copiar && paso === "precios") ? "Cancelar" : "Volver"}
            </Button>
            {paso === "datos" && (
              <Button onClick={irAPrecios} loading={cargando}>
                Continuar
              </Button>
            )}
            {paso === "precios" && (
              <Button onClick={() => setPaso("confirmar")} disabled={!preciosValidos || cargando}>
                Continuar
              </Button>
            )}
            {paso === "confirmar" && (
              <Button onClick={confirmar} loading={enviando}>
                Confirmar y crear en Alegra
              </Button>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {aviso && <Alert tone="warning">{aviso}</Alert>}

        {!aviso && paso === "datos" && (
          <>
            <Field label="Nombre" hint={sugeridos.nombre ? sugeridos.nombre : undefined}>
              <Input value={nombre} onChange={(e) => { tocar("nombre"); setNombre(e.target.value) }} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Código del proveedor" hint={sugeridos.codigo ? "sugerido" : undefined}>
                <Input value={codigo} onChange={(e) => { tocar("codigo"); setCodigo(e.target.value) }} />
              </Field>
              <Field label="Marca" hint={sugeridos.marca ? "sugerido" : undefined}>
                <Input value={marca} onChange={(e) => { tocar("marca"); setMarca(e.target.value) }} onBlur={() => marca.trim() && void pedirSugerencias(marca.trim())} />
              </Field>
              <Field label="Sufijo de la marca" hint={`Referencia en Alegra: ${referencia}${sugeridos.sufijo ? ` (${sugeridos.sufijo})` : ""}`}>
                <Input value={sufijo} onChange={(e) => { tocar("sufijo"); setSufijo(e.target.value.toUpperCase()) }} placeholder="Ej.: MCL" />
              </Field>
              <Field label="Unidad de medida">
                <Select value={unidad} onValueChange={setUnidad} options={UNIDADES} aria-label="Unidad de medida" />
              </Field>
              <Field label="IVA" hint={sugeridos.iva ? "sugerido" : undefined}>
                <Select value={iva} onValueChange={(v) => { tocar("iva"); setIva(v) }} options={OPCIONES_IVA} aria-label="IVA" />
              </Field>
              <Field label="Costo unitario (sin IVA)">
                <Input inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} />
              </Field>
            </div>
          </>
        )}

        {!aviso && paso === "precios" && (
          <>
            {cargando && <Spinner label="Cargando listas de precio" />}
            {!cargando && filas.length > 0 && (
              <>
                <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                  Costo: {Number.isFinite(costoNum) ? costoNum.toFixed(2) : "—"} (sin IVA). Edite el porcentaje o el precio de cada lista; los precios son netos, sin IVA.
                </p>
                <div className="flex flex-col gap-2">
                  {filas.map((f, i) => (
                    <div key={f.id} className="grid items-end gap-2 md:grid-cols-[1fr_7rem_9rem]">
                      <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>{f.nombre}</p>
                      <Field label={i === 0 ? "% sobre costo" : undefined}>
                        <Input inputMode="decimal" value={f.porcentaje} onChange={(e) => editarPorcentaje(f.id, e.target.value)} aria-label={`Porcentaje de ${f.nombre}`} />
                      </Field>
                      <Field label={i === 0 ? "Precio sin IVA" : undefined}>
                        <Input inputMode="decimal" value={f.precio} onChange={(e) => editarPrecio(f.id, e.target.value)} aria-label={`Precio de ${f.nombre}`} />
                      </Field>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {!aviso && paso === "confirmar" && (
          <div className="flex flex-col gap-2 text-sm" style={{ color: "var(--ink)" }}>
            <p>
              Se creará en Alegra, cuenta de <strong>{nombreCuenta}</strong>, el producto <strong>{nombreProducto}</strong>
              {!copiar && <> con la referencia <strong>{referencia}</strong></>}.
            </p>
            <ul className="list-disc pl-5" style={{ color: "var(--ink-soft)" }}>
              <li>Costo: {Number.isFinite(costoNum) ? costoNum.toFixed(2) : "—"} (sin IVA). Se permite vender sin stock.</li>
              {filas.map((f) => (
                <li key={f.id}>
                  {f.nombre}: {num(f.precio).toFixed(2)} ({f.porcentaje} %)
                </li>
              ))}
            </ul>
            {ajustadas.length > 0 && (
              <p style={{ color: "var(--ink-soft)" }}>
                {ajustadas.length === 1 ? "La lista" : "Las listas"} {ajustadas.map((f) => f.nombre).join(", ")} no usa{ajustadas.length === 1 ? "" : "n"} el porcentaje habitual.
              </p>
            )}
            <p>Esta operación escribe en Alegra. ¿Desea continuar?</p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
