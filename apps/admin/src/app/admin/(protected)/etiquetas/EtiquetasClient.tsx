"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Alert, Button, Card, Field, Progress, Select, Spinner } from "@myd-org/ui"
import { api } from "@/components/admin/catalogo/tipos"
import { dibujarHojaPrecio4, dibujarHojaQr6 } from "@/lib/etiquetas/canvas"
import { agregarSinDuplicar, aplicarStockSucursal, itemsDeLista, mensajeEnviadas, tituloOmitidos, type FilaLista } from "@/lib/etiquetas/lista"
import { rotuloTienda, tiendaDelQr } from "@/lib/etiquetas/qr"
import {
  layoutPrecio4,
  layoutQr6,
  TIPOS_CON_PRECIO,
  TIPOS_ROLLO_CHICO,
  trabajoCodigos,
  trabajoPrecio4,
  trabajoPrecios,
  trabajoQr6,
  type ItemEtiqueta,
  type Omitido,
  type PrecioEtiqueta,
  type TipoEtiqueta,
} from "@/lib/etiquetas/trabajos"
import { useImpresora, type EstadoImpresora } from "@/lib/etiquetas/useImpresora"
import type { ContextoEtiquetas } from "@/lib/etiquetas-repo"
import { ConfirmarRollo } from "./ConfirmarRollo"
import { ListaImpresion } from "./ListaImpresion"
import { SelectorProductos } from "./SelectorProductos"
import { VistaPrevia } from "./VistaPrevia"

const TEXTO_ESTADO: Record<EstadoImpresora, string> = {
  verificando: "Comprobando la impresora…",
  "sin-soporte": "Este navegador no puede imprimir por USB.",
  "sin-conectar": "No hay una impresora conectada.",
  conectada: "Impresora conectada.",
  imprimiendo: "Enviando a la impresora…",
  error: "No se pudo completar la última operación.",
}

const TIPOS: { value: TipoEtiqueta; label: string }[] = [
  { value: "codigos-29x20", label: "Código de barras 29x20 (3 por fila)" },
  { value: "precio-29x20", label: "Precio 29x20 (3 por fila)" },
  { value: "qr-6up", label: "QR 6 por hoja (100x150)" },
  { value: "precio-4up", label: "Precio 4 por hoja (100x150)" },
]

const MENSAJE_SIN_SHOP = "La tienda no tiene dirección web configurada; no se pueden generar códigos QR."
const MENSAJE_PRECIOS_PENDIENTES = "Espere a que se carguen los precios de la tienda web."
const MANUAL = "__manual"

/** Precios conocidos por alegraId (`null` = el Shop no tiene ese producto). */
type MapaPrecios = Record<string, PrecioEtiqueta | null>

/** Lo que entienden `trabajoPrecios` / `layoutPrecio4`: sólo los productos con precio. */
function soloConPrecio(m: MapaPrecios): Record<string, PrecioEtiqueta> {
  const out: Record<string, PrecioEtiqueta> = {}
  for (const [id, p] of Object.entries(m)) if (p) out[id] = p
  return out
}

/** Etiquetas y omitidos de un tipo con precio, sin dibujar (para confirmar y para la lista). */
function previstasPrecio(tipo: TipoEtiqueta, items: ItemEtiqueta[], precios: Record<string, PrecioEtiqueta>): { etiquetas: number; omitidos: Omitido[] } {
  return tipo === "precio-4up" ? layoutPrecio4(items, precios) : trabajoPrecios(items, precios)
}

export function EtiquetasClient() {
  const impresora = useImpresora()
  const [contexto, setContexto] = useState<ContextoEtiquetas | null>(null)
  const [errorContexto, setErrorContexto] = useState<string | null>(null)
  const [tipo, setTipo] = useState<TipoEtiqueta>("codigos-29x20")
  const [lista, setLista] = useState<FilaLista[]>([])
  const [sucursal, setSucursal] = useState<string | null>(null)
  const [tiendaElegida, setTiendaElegida] = useState<string | null>(null)
  const [invalidas, setInvalidas] = useState<Set<string>>(new Set())
  const [confirmar, setConfirmar] = useState<number | null>(null)
  const [preparando, setPreparando] = useState(false)
  const [resultado, setResultado] = useState<{ error?: string; omitidos: Omitido[] } | null>(null)
  const [precios, setPrecios] = useState<MapaPrecios>({})
  const [cargandoPrecios, setCargandoPrecios] = useState(false)
  const [errorPrecios, setErrorPrecios] = useState<string | null>(null)
  const [reintentoPrecios, setReintentoPrecios] = useState(0)
  const preciosOk = useMemo(() => soloConPrecio(precios), [precios])

  useEffect(() => {
    api<ContextoEtiquetas>("/api/admin/etiquetas/contexto")
      .then(setContexto)
      .catch((e: unknown) => setErrorContexto(e instanceof Error ? e.message : "No se pudieron cargar los datos de la tienda."))
  }, [])

  const conPrecio = TIPOS_CON_PRECIO.includes(tipo)
  // Ids de la lista sin precio pedido todavía (clave estable para el efecto).
  const faltantes = conPrecio ? lista.map((f) => f.alegraId).filter((id) => !(id in precios)) : []
  const claveFaltantes = faltantes.join(",")

  // Los tipos con precio piden al Shop (vía el CRM) sólo los productos que faltan; la respuesta
  // queda en memoria mientras dure la pantalla. Los que el Shop no tiene quedan en null.
  useEffect(() => {
    if (!claveFaltantes) return
    const ids = claveFaltantes.split(",")
    let vigente = true
    const t = setTimeout(() => {
      setCargandoPrecios(true)
      setErrorPrecios(null)
      api<{ precios: Record<string, PrecioEtiqueta> }>("/api/admin/etiquetas/precios", {
        method: "POST",
        body: JSON.stringify({ ids }),
      })
        .then((r) => {
          if (!vigente) return
          setPrecios((m) => {
            const n = { ...m }
            for (const id of ids) n[id] = r.precios[id] ?? null
            return n
          })
        })
        .catch((e: unknown) => {
          if (vigente) setErrorPrecios(e instanceof Error ? e.message : "No se pudieron obtener los precios de la tienda web.")
        })
        .finally(() => {
          if (vigente) setCargandoPrecios(false)
        })
    }, 300)
    return () => {
      vigente = false
      clearTimeout(t)
    }
  }, [claveFaltantes, reintentoPrecios])

  const tiendas = useMemo(() => contexto?.tiendas ?? [], [contexto])
  // Destino del QR (y host impreso): la tienda elegida; por defecto, la principal.
  const shopUrl = tiendas.length > 0 ? tiendaDelQr(tiendas, tiendaElegida) : (contexto?.tenant.shopUrl ?? null)
  const sucursales = useMemo(() => (contexto?.sucursales ?? []).filter((s) => s.activa), [contexto])
  const { items } = useMemo(() => itemsDeLista(lista), [lista])
  const qrBloqueado = tipo === "qr-6up" && !shopUrl
  const ocupada = preparando || impresora.estado === "imprimiendo"

  const onAgregar = useCallback(
    (nuevas: FilaLista[]) => {
      const r = agregarSinDuplicar(lista, sucursal ? aplicarStockSucursal(nuevas, sucursal) : nuevas)
      setLista(r.lista)
      return r.agregadas
    },
    [lista, sucursal],
  )

  const cambiarSucursal = (v: string) => {
    const slug = v === MANUAL ? null : v
    setSucursal(slug)
    setLista((l) => aplicarStockSucursal(l, slug))
    setInvalidas(new Set())
  }

  const tocar = (alegraId: string, valida: boolean) =>
    setInvalidas((s) => {
      const n = new Set(s)
      if (valida) n.delete(alegraId)
      else n.add(alegraId)
      return n
    })

  const pedirImpresion = () => {
    setResultado(null)
    const { invalidas: malas } = itemsDeLista(lista)
    setInvalidas(new Set(malas))
    if (malas.length > 0 || items.length === 0) return
    if (conPrecio && faltantes.length > 0) {
      setResultado({ error: errorPrecios ?? MENSAJE_PRECIOS_PENDIENTES, omitidos: [] })
      return
    }
    const prevision =
      tipo === "codigos-29x20"
        ? trabajoCodigos(items)
        : conPrecio
          ? previstasPrecio(tipo, items, preciosOk)
          : (() => {
              const l = layoutQr6(items, shopUrl)
              return l.ok ? l : { etiquetas: 0, omitidos: [] }
            })()
    if (prevision.etiquetas === 0) {
      setResultado({ error: "Ningún producto de la lista se puede imprimir con este tipo de etiqueta.", omitidos: prevision.omitidos })
      return
    }
    setConfirmar(prevision.etiquetas)
  }

  const armarTrabajos = async () => {
    if (tipo === "codigos-29x20") return { ok: true as const, ...trabajoCodigos(items) }
    if (tipo === "precio-29x20") return { ok: true as const, ...trabajoPrecios(items, preciosOk) }
    if (tipo === "precio-4up") return { ok: true as const, ...(await trabajoPrecio4(items, preciosOk, dibujarHojaPrecio4)) }
    return trabajoQr6(items, shopUrl, dibujarHojaQr6)
  }

  const imprimir = async () => {
    setConfirmar(null)
    // La conexión va primero: puede abrir el selector del navegador y necesita el clic.
    if (!impresora.tieneDispositivo && !(await impresora.conectar())) return
    setPreparando(true)
    try {
      const r = await armarTrabajos()
      if (!r.ok) {
        setResultado({ error: r.mensaje, omitidos: [] })
        return
      }
      setResultado({ omitidos: r.omitidos })
      setPreparando(false)
      await impresora.imprimir(
        r.trabajos.map((t) => t.datos as Uint8Array<ArrayBuffer>),
        mensajeEnviadas(r.etiquetas),
      )
    } catch (e) {
      console.error("[etiquetas] armado del trabajo:", e)
      setResultado({ error: "No se pudieron preparar las etiquetas. Inténtelo nuevamente.", omitidos: [] })
    } finally {
      setPreparando(false)
    }
  }

  const { progreso } = impresora
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="flex flex-col gap-4 min-w-0">
        {errorContexto && <Alert tone="danger">{errorContexto}</Alert>}
        <Card title="Productos" description="Busque productos por nombre o código, o agregue todos los de una marca.">
          <SelectorProductos marcas={contexto?.marcas ?? []} onAgregar={onAgregar} />
        </Card>

        <Card
          title="Lista de impresión"
          description="Cada unidad de cantidad es una etiqueta."
          action={
            lista.length > 0 ? (
              <Button variant="link" size="sm" onClick={() => setLista([])} disabled={ocupada}>
                Vaciar
              </Button>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-3">
            <Field label="Cantidades" hint="Con stock de sucursal, el stock 0 o negativo cuenta como 1 etiqueta.">
              <Select
                aria-label="Origen de las cantidades"
                value={sucursal ?? MANUAL}
                onValueChange={cambiarSucursal}
                options={[
                  { value: MANUAL, label: "Cargar a mano" },
                  ...sucursales.map((s) => ({ value: s.slug, label: `Usar stock de sucursal: ${s.nombre}` })),
                ]}
              />
            </Field>
            <ListaImpresion
              lista={lista}
              onCambiar={(l) => {
                setLista(l)
                setInvalidas((s) => new Set([...s].filter((id) => l.some((f) => f.alegraId === id))))
              }}
              sucursal={sucursal}
              usaReferencia={tipo === "codigos-29x20"}
              precios={conPrecio ? precios : null}
              invalidas={invalidas}
              onTocar={tocar}
            />
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4 min-w-0">
        <Card title="Etiqueta">
          <div className="flex flex-col gap-3">
            <Field label="Tipo de etiqueta">
              <Select
                aria-label="Tipo de etiqueta"
                value={tipo}
                onValueChange={(v) => {
                  setTipo(v as TipoEtiqueta)
                  setConfirmar(null)
                  setResultado(null)
                }}
                options={TIPOS}
              />
            </Field>
            {tipo === "qr-6up" && tiendas.length > 1 && (
              <Field label="Tienda del código QR" hint="El código QR y la dirección impresa llevan a esta tienda.">
                <Select
                  aria-label="Tienda del código QR"
                  value={shopUrl ?? ""}
                  onValueChange={(v) => {
                    setTiendaElegida(v)
                    setConfirmar(null)
                    setResultado(null)
                  }}
                  options={tiendas.map((t) => ({ value: t.url, label: rotuloTienda(t) }))}
                  disabled={ocupada}
                />
              </Field>
            )}
            {conPrecio && (
              <p className="text-sm" style={{ color: "var(--ink-faint)" }}>
                Los precios son los que muestra la tienda web: el del medio de pago destacado y el de lista, con IVA.
              </p>
            )}
            {conPrecio && cargandoPrecios && (
              <p className="flex items-center gap-2 text-sm">
                <Spinner /> Cargando los precios de la tienda web…
              </p>
            )}
            {conPrecio && errorPrecios && (
              <Alert tone="danger">
                <p>{errorPrecios}</p>
                <Button variant="link" size="sm" onClick={() => setReintentoPrecios((n) => n + 1)} disabled={cargandoPrecios}>
                  Reintentar
                </Button>
              </Alert>
            )}
            {qrBloqueado ? (
              <Alert tone="warning">{MENSAJE_SIN_SHOP}</Alert>
            ) : (
              <VistaPrevia tipo={tipo} items={items} shopUrl={shopUrl} precios={conPrecio ? preciosOk : null} />
            )}
          </div>
        </Card>

        <Card title="Impresora">
          <div className="flex flex-col gap-3">
            <p className="text-sm" role="status">{TEXTO_ESTADO[impresora.estado]}</p>
            {impresora.estado === "sin-soporte" && <Alert tone="warning">{impresora.error}</Alert>}
            {impresora.estado === "error" && impresora.error && <Alert tone="danger">{impresora.error}</Alert>}
            {impresora.aviso && <Alert tone="success">{impresora.aviso}</Alert>}
            {resultado?.error && <Alert tone="danger">{resultado.error}</Alert>}
            {resultado && resultado.omitidos.length > 0 && (
              <Alert tone="warning">
                <p>{tituloOmitidos(resultado.omitidos)}</p>
                <ul className="list-disc pl-5">
                  {resultado.omitidos.map((o) => (
                    <li key={o.alegraId}>
                      {o.nombre}: {o.motivo}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
            {preparando && (
              <p className="flex items-center gap-2 text-sm">
                <Spinner /> Preparando las etiquetas…
              </p>
            )}
            {progreso && (
              <Progress
                value={progreso.total ? Math.round((progreso.enviados / progreso.total) * 100) : 0}
                aria-label="Envío a la impresora"
              />
            )}
            <div className="flex flex-wrap gap-2">
              {!impresora.tieneDispositivo && (
                <Button
                  variant="secondary"
                  onClick={() => void impresora.conectar()}
                  disabled={impresora.estado === "sin-soporte" || impresora.estado === "verificando" || ocupada}
                >
                  Conectar impresora
                </Button>
              )}
              <Button
                onClick={pedirImpresion}
                disabled={
                  items.length === 0 || qrBloqueado || ocupada || impresora.estado === "sin-soporte" || (conPrecio && cargandoPrecios)
                }
                loading={ocupada}
              >
                Imprimir
              </Button>
              <Button
                variant="ghost"
                onClick={() => void impresora.imprimirPrueba(TIPOS_ROLLO_CHICO.includes(tipo) ? "chico" : "grande")}
                disabled={!impresora.tieneDispositivo || ocupada}
              >
                Imprimir prueba
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <ConfirmarRollo
        tipo={tipo}
        abierto={confirmar !== null}
        etiquetas={confirmar ?? 0}
        onCancelar={() => setConfirmar(null)}
        onConfirmar={() => void imprimir()}
      />
    </div>
  )
}
