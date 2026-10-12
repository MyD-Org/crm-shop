"use client"

import { useEffect, useRef, useState } from "react"
import { Badge, Button, Dialog, Field, Input, SearchInput } from "@myd-org/ui"
import { api, ErrorApi, precioDeLista, type ListadoDto, type ProductoDto } from "./tipos"
import { candidatosDeModelo, candidatosParaSumar, etiquetaSugerida, necesitaEtiquetaBase } from "./variantes-ui"

/**
 * Suma a mano un producto suelto a un modelo (caso real: el «RGB» es otro producto de Alegra, con otro
 * precio, pero en la tienda tiene que verse como una opción más del modelo).
 *
 * Dos entradas, mismo diálogo:
 *  - «producto»: se abre desde un producto suelto y se busca el MODELO al que sumarlo;
 *  - «modelo»: se abre desde un modelo y se busca el PRODUCTO suelto que se le suma.
 * Si el modelo elegido es un producto suelto, pasa a ser la base de un grupo nuevo y hay que indicar
 * cómo se llama su opción. Las reglas las valida el servidor; acá sólo se ayuda a elegir.
 */

interface Props {
  modo: "producto" | "modelo"
  /** El producto desde el que se abrió: el que se suma («producto») o el modelo de destino («modelo»). */
  fijo: ProductoDto
  onCerrar: () => void
  /** Se sumó: el panel recarga el listado. */
  onListo: () => void
}

const ESPERA_BUSQUEDA_MS = 300

/** Errores del servidor que se muestran junto al campo que los causó, no arriba. */
const CAMPOS_DEL_FORMULARIO = ["etiqueta", "etiquetaAncla", "orden"]

export function SumarAlGrupoDialog({ modo, fijo, onCerrar, onListo }: Props) {
  const [busqueda, setBusqueda] = useState("")
  const [resultados, setResultados] = useState<ProductoDto[]>([])
  const [buscando, setBuscando] = useState(false)
  const [elegido, setElegido] = useState<ProductoDto | null>(null)
  const [etiqueta, setEtiqueta] = useState(modo === "producto" ? etiquetaSugerida(fijo.nombreAlegra) : "")
  const [orden, setOrden] = useState("")
  const [etiquetaBase, setEtiquetaBase] = useState("")
  const [error, setError] = useState("")
  const [errorCampo, setErrorCampo] = useState<string | undefined>()
  const [guardando, setGuardando] = useState(false)
  const pedidoActual = useRef(0)

  // Los dos extremos de la operación, según desde dónde se abrió.
  const producto = modo === "producto" ? fijo : elegido
  const modelo = modo === "producto" ? elegido : fijo
  const buscaModelo = modo === "producto"

  useEffect(() => {
    const texto = busqueda.trim()
    if (texto.length < 2) {
      // Sin texto suficiente no se consulta: el listado entero no es una lista de candidatos.
      pedidoActual.current++
      return
    }
    const t = setTimeout(() => {
      const pedido = ++pedidoActual.current
      setBuscando(true)
      const params = new URLSearchParams({ q: texto, limit: "15" })
      api<ListadoDto>(`/api/admin/catalogo/productos?${params.toString()}`)
        .then((r) => {
          if (pedido !== pedidoActual.current) return
          setResultados(buscaModelo ? candidatosDeModelo(r.items, fijo.alegraId) : candidatosParaSumar(r.items, fijo.alegraId))
          setError("")
        })
        .catch((err) => {
          if (pedido !== pedidoActual.current) return
          setError(err instanceof ErrorApi ? err.message : "No pudimos buscar. Inténtelo nuevamente.")
        })
        .finally(() => {
          if (pedido === pedidoActual.current) setBuscando(false)
        })
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(t)
  }, [busqueda, buscaModelo, fijo.alegraId])

  const hayBusqueda = busqueda.trim().length >= 2
  const mostrados = hayBusqueda ? resultados : []
  const pideBase = modelo !== null && necesitaEtiquetaBase(modelo)

  function elegir(p: ProductoDto) {
    setElegido(p)
    setError("")
    setErrorCampo(undefined)
    // Al elegir el producto a sumar se propone su etiqueta; al elegir el modelo ya viene la del producto fijo.
    if (!buscaModelo && etiqueta.trim() === "") setEtiqueta(etiquetaSugerida(p.nombreAlegra))
  }

  async function guardar() {
    if (!producto || !modelo) return
    setGuardando(true)
    setError("")
    setErrorCampo(undefined)
    try {
      const ordenNumero = orden.trim() === "" ? undefined : Number(orden)
      await api("/api/admin/catalogo/variantes", {
        method: "POST",
        body: JSON.stringify({
          alegraId: producto.alegraId,
          grupoId: modelo.alegraId,
          etiqueta,
          ...(ordenNumero !== undefined ? { orden: ordenNumero } : {}),
          ...(pideBase ? { etiquetaAncla: etiquetaBase } : {}),
        }),
      })
      onListo()
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos sumar el producto al modelo. Inténtelo nuevamente.")
      setErrorCampo(err instanceof ErrorApi ? err.campo : undefined)
    } finally {
      setGuardando(false)
    }
  }

  const puedeGuardar = producto !== null && modelo !== null && etiqueta.trim() !== "" && (!pideBase || etiquetaBase.trim() !== "")

  return (
    <Dialog
      open
      size="md"
      dismissible={false}
      onOpenChange={(abierto) => {
        if (!abierto) onCerrar()
      }}
      title={modo === "producto" ? "Sumar a un modelo" : "Sumar un producto al modelo"}
      description={
        modo === "producto"
          ? `Producto: ${fijo.nombreEfectivo}`
          : `Modelo: ${fijo.nombreEfectivo}`
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={!puedeGuardar || guardando}>
            {guardando ? "Sumando…" : "Sumar al modelo"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
          {modo === "producto"
            ? "En la tienda, este producto va a aparecer como una opción más del modelo que elija, con su propio precio y stock."
            : "El producto que sume va a aparecer en la tienda como una opción más de este modelo, con su propio precio y stock."}
        </p>

        {error && !CAMPOS_DEL_FORMULARIO.includes(errorCampo ?? "") && (
          <p className="rounded-[var(--radius)] p-2 text-sm" style={{ background: "var(--red-soft)", color: "var(--red)" }} role="alert">
            {error}
          </p>
        )}

        <section className="flex flex-col gap-2">
          <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
            {buscaModelo ? "1. Elija el modelo" : "1. Elija el producto a sumar"}
          </span>
          {elegido ? (
            <div className="flex items-center justify-between gap-2 rounded-[var(--radius)] p-2" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium" style={{ color: "var(--ink)" }}>
                  {elegido.nombreEfectivo}
                </div>
                <div className="text-xs" style={{ color: "var(--ink-faint)" }}>
                  SKU {elegido.sku}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setElegido(null)} disabled={guardando}>
                Cambiar
              </Button>
            </div>
          ) : (
            <>
              <SearchInput
                value={busqueda}
                onValueChange={setBusqueda}
                onClear={() => setBusqueda("")}
                placeholder={buscaModelo ? "Busque el modelo por nombre o código" : "Busque el producto por nombre o código"}
                aria-label={buscaModelo ? "Buscar el modelo" : "Buscar el producto a sumar"}
              />
              {hayBusqueda && !buscando && mostrados.length === 0 && (
                <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
                  {buscaModelo
                    ? "No encontramos modelos ni productos sueltos con ese texto."
                    : "No encontramos productos sueltos con ese texto. Los que ya están en un modelo no se pueden sumar a otro."}
                </p>
              )}
              {!hayBusqueda && (
                <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
                  Escriba al menos dos letras para buscar.
                </p>
              )}
              <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                {mostrados.map((p) => (
                  <li key={p.alegraId}>
                    <button
                      type="button"
                      onClick={() => elegir(p)}
                      className="flex w-full items-center justify-between gap-2 rounded-[var(--radius)] p-2 text-left"
                      style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm" style={{ color: "var(--ink)" }}>
                          {p.nombreEfectivo}
                        </span>
                        <span className="block text-xs" style={{ color: "var(--ink-faint)" }}>
                          SKU {p.sku}
                          {p.tipo !== "padre" && ` · ${precioDeLista(p.prices) ?? "Sin precio"}`}
                        </span>
                      </span>
                      {buscaModelo && (
                        <Badge tone={p.tipo === "padre" || p.esAncla ? "info" : "neutral"}>
                          {p.tipo === "padre" || p.esAncla ? "Modelo" : "Producto suelto"}
                        </Badge>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
            2. Indique cómo se llama esta opción
          </span>
          <Field
            label="Opción en el modelo"
            hint="Es lo que ve el cliente al elegir, por ejemplo «RGB» o «Blanco cálido»."
            error={errorCampo === "etiqueta" ? error : undefined}
          >
            <Input value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Por ejemplo: RGB" maxLength={60} />
          </Field>
          {pideBase && (
            <Field
              label={`Opción del producto base (${modelo?.nombreEfectivo})`}
              hint="El producto que eligió como modelo no está en ningún grupo: pasa a ser la base de uno nuevo y también necesita su opción."
              error={errorCampo === "etiquetaAncla" ? error : undefined}
            >
              <Input value={etiquetaBase} onChange={(e) => setEtiquetaBase(e.target.value)} placeholder="Por ejemplo: Blanco" maxLength={60} />
            </Field>
          )}
          <Field
            label="Orden (opcional)"
            hint="Un número menor se muestra antes entre las opciones. Sin orden, queda después de las del modelo."
            error={errorCampo === "orden" ? error : undefined}
          >
            <Input value={orden} onChange={(e) => setOrden(e.target.value)} inputMode="numeric" placeholder="Por ejemplo: 10" />
          </Field>
        </section>
      </div>
    </Dialog>
  )
}
