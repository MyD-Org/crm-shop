"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Mail, RefreshCw } from "lucide-react"
import { Alert, Button, EmptyState, SearchInput, SegmentedControl, Skeleton } from "@myd-org/ui"
import type { CorreoCarpeta, CorreoHilo, CorreoPaginaHilos } from "@/lib/correo-resend"
import { CARPETAS_UI, fusionarHilos } from "@/lib/correo-formato"
import { HiloList } from "@/components/admin/correo/HiloList"
import { HiloView } from "@/components/admin/correo/HiloView"

interface Props {
  casillaId: string
  /** Hilo a abrir al entrar (viene del aviso push: ?hilo=). */
  initialHiloId?: string | null
  /** Cambió la cantidad de no leídos de Recibidos de esta casilla (para el número de la solapa). */
  onNoLeidosDelta: (delta: number) => void
}

const TAMANO_PAGINA = 25

// Contenido de una solapa de casilla dentro de Mensajes: carpetas, búsqueda por asunto, lista de
// hilos con "Cargar más" por cursor y el detalle del hilo al costado (en pantallas chicas, en
// lugar de la lista). Todo se pide a /api/admin/correo/...; los cuerpos, al abrir cada mensaje.
export function CorreoView({ casillaId, initialHiloId = null, onNoLeidosDelta }: Props) {
  const [carpeta, setCarpeta] = useState<CorreoCarpeta>("inbox")
  const [busqueda, setBusqueda] = useState("")
  const [consulta, setConsulta] = useState("")
  const [hilos, setHilos] = useState<CorreoHilo[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [siguiente, setSiguiente] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hiloAbierto, setHiloAbierto] = useState<string | null>(initialHiloId)
  const [recarga, setRecarga] = useState(0)
  // La respuesta de un fetch que quedó en vuelo cuando cambió la carpeta/búsqueda se descarta.
  const pedidoActual = useRef(0)

  const urlDeLista = useCallback(
    (after?: string) => {
      const qs = new URLSearchParams({ folder: carpeta, limit: String(TAMANO_PAGINA) })
      if (consulta) qs.set("q", consulta)
      if (after) qs.set("after", after)
      return `/api/admin/correo/casillas/${casillaId}/hilos?${qs}`
    },
    [casillaId, carpeta, consulta],
  )

  useEffect(() => {
    const mio = ++pedidoActual.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- estado de carga previo al fetch
    setCargando(true)
    setError(null)
    fetch(urlDeLista(), { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (mio !== pedidoActual.current) return
        if (!res.ok) throw new Error(data?.error || "No se pudo cargar el correo.")
        const pagina = data as CorreoPaginaHilos
        setHilos(pagina.hilos)
        setHasMore(pagina.hasMore)
        setSiguiente(pagina.siguiente)
      })
      .catch((e: unknown) => {
        if (mio === pedidoActual.current) setError(e instanceof Error ? e.message : "No se pudo cargar el correo.")
      })
      .finally(() => {
        if (mio === pedidoActual.current) setCargando(false)
      })
  }, [urlDeLista, recarga])

  const cargarMas = async () => {
    if (!siguiente) return
    const mio = pedidoActual.current
    setCargandoMas(true)
    try {
      const res = await fetch(urlDeLista(siguiente), { cache: "no-store" })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "No se pudo cargar más correo.")
      if (mio !== pedidoActual.current) return
      const pagina = data as CorreoPaginaHilos
      setHilos((prev) => fusionarHilos(prev, pagina.hilos))
      setHasMore(pagina.hasMore)
      setSiguiente(pagina.siguiente)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar más correo.")
    } finally {
      setCargandoMas(false)
    }
  }

  const abrirHilo = (id: string | null) => {
    setHiloAbierto(id)
    // La URL refleja el hilo abierto (sin recargar la página ni agregar historial).
    try {
      const url = new URL(window.location.href)
      if (id) url.searchParams.set("hilo", id)
      else url.searchParams.delete("hilo")
      window.history.replaceState(null, "", url)
    } catch {
      // Sin history disponible: el hilo abierto vale solo para esta sesión.
    }
  }

  const onCambio = (id: string, cambio: { leido?: boolean; carpeta?: "inbox" | "archive" | "spam" | "trash" }) => {
    const h = hilos.find((x) => x.id === id)
    if (h) {
      const antes = carpeta === "inbox" && !h.leido
      const carpetaNueva = cambio.carpeta ?? carpeta
      const despues = carpetaNueva === "inbox" && !(cambio.leido ?? h.leido)
      if (antes !== despues) onNoLeidosDelta(despues ? 1 : -1)
    }
    setHilos((prev) =>
      cambio.carpeta && cambio.carpeta !== carpeta
        ? prev.filter((x) => x.id !== id)
        : prev.map((x) => (x.id === id ? { ...x, leido: cambio.leido ?? x.leido } : x)),
    )
  }

  const cambiarCarpeta = (c: string) => {
    setCarpeta(c as CorreoCarpeta)
    abrirHilo(null)
  }

  const buscar = (e: React.FormEvent) => {
    e.preventDefault()
    setConsulta(busqueda.trim())
    abrirHilo(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="min-w-0 overflow-x-auto">
          <SegmentedControl ariaLabel="Carpeta" size="sm" value={carpeta} onValueChange={cambiarCarpeta} options={CARPETAS_UI} />
        </div>
        <form onSubmit={buscar} className="flex-1 min-w-[180px] max-w-sm" role="search">
          <SearchInput
            value={busqueda}
            onValueChange={setBusqueda}
            onClear={() => {
              setBusqueda("")
              setConsulta("")
            }}
            clearLabel="Borrar búsqueda"
            placeholder="Buscar por asunto"
            aria-label="Buscar por asunto"
          />
        </form>
        <Button variant="ghost" size="sm" onClick={() => setRecarga((n) => n + 1)} aria-label="Actualizar">
          <RefreshCw size={14} /> Actualizar
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className={hiloAbierto ? "hidden lg:block" : ""}>
          {error && (
            <Alert tone="danger" className="mb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span>{error}</span>
                <Button size="sm" variant="outline" onClick={() => setRecarga((n) => n + 1)}>Reintentar</Button>
              </div>
            </Alert>
          )}
          {cargando ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : hilos.length === 0 ? (
            !error && (
              <EmptyState
                icon={<Mail size={28} strokeWidth={1.2} />}
                title={consulta ? "No hay conversaciones con ese asunto" : "No hay conversaciones en esta carpeta"}
              />
            )
          ) : (
            <div className="flex flex-col gap-3">
              <HiloList hilos={hilos} seleccionado={hiloAbierto} onSeleccionar={(h) => abrirHilo(h.id)} />
              {hasMore && (
                <Button variant="outline" onClick={() => void cargarMas()} loading={cargandoMas} className="self-center">
                  Cargar más
                </Button>
              )}
            </div>
          )}
        </div>

        <div className={hiloAbierto ? "" : "hidden lg:block"}>
          {hiloAbierto ? (
            <HiloView
              key={hiloAbierto}
              casillaId={casillaId}
              hiloId={hiloAbierto}
              onVolver={() => abrirHilo(null)}
              onCambio={onCambio}
            />
          ) : (
            <EmptyState icon={<Mail size={28} strokeWidth={1.2} />} title="Seleccione una conversación" />
          )}
        </div>
      </div>
    </div>
  )
}
