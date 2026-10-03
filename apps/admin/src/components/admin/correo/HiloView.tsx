"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, Download, Forward, Paperclip, Reply, ReplyAll } from "lucide-react"
import { Alert, Badge, Button, Skeleton, useToast } from "@myd-org/ui"
import type { CorreoCarpeta, CorreoHiloDetalle, CorreoMensaje } from "@/lib/correo-resend"
import { SECTION_VISITED_EVENT } from "@/lib/admin-last-visit"
import { fechaCompletaCorreo, nombreRemitente, tamanoLegible } from "@/lib/correo-formato"
import { MensajeHtml } from "@/components/admin/correo/MensajeHtml"
import { Composer } from "@/components/admin/correo/Composer"
import type { ModoEnvio } from "@/lib/correo-compose"
import type { AvisoEntrega } from "@/lib/correo-entrega"

type Destino = "inbox" | "archive" | "spam" | "trash"

interface Props {
  casillaId: string
  /** Datos de la casilla para el `from` y la cita al responder (el servidor igual los fuerza). */
  casilla: { id: string; nombre: string; email: string }
  hiloId: string
  onVolver: () => void
  /** El hilo cambió de estado: la lista lo refleja sin volver a pedirse. */
  onCambio: (hiloId: string, cambio: { leido?: boolean; carpeta?: Destino }) => void
  /** Se envió una respuesta o un reenvío: la lista se refresca. */
  onEnviado: () => void
}

interface Accion {
  etiqueta: string
  destino: Destino
}

// Acciones de carpeta según dónde está el hilo. "Eliminar" mueve a la papelera: no hay borrado
// definitivo desde el CRM.
function accionesDe(carpeta: CorreoCarpeta | null): Accion[] {
  switch (carpeta) {
    case "archive":
      return [{ etiqueta: "Mover a Recibidos", destino: "inbox" }, { etiqueta: "Marcar como spam", destino: "spam" }, { etiqueta: "Eliminar", destino: "trash" }]
    case "spam":
      return [{ etiqueta: "No es spam", destino: "inbox" }, { etiqueta: "Eliminar", destino: "trash" }]
    case "trash":
      return [{ etiqueta: "Restaurar a Recibidos", destino: "inbox" }]
    case "sent":
      return [{ etiqueta: "Archivar", destino: "archive" }, { etiqueta: "Eliminar", destino: "trash" }]
    default:
      return [{ etiqueta: "Archivar", destino: "archive" }, { etiqueta: "Marcar como spam", destino: "spam" }, { etiqueta: "Eliminar", destino: "trash" }]
  }
}

export function HiloView({ casillaId, casilla, hiloId, onVolver, onCambio, onEnviado }: Props) {
  const [hilo, setHilo] = useState<CorreoHiloDetalle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [trabajando, setTrabajando] = useState(false)
  const [redactando, setRedactando] = useState<ModoEnvio | null>(null)
  const { toast } = useToast()
  // El padre pasa una función nueva en cada render: va en un ref para no relanzar la carga.
  const onCambioRef = useRef(onCambio)
  useEffect(() => {
    onCambioRef.current = onCambio
  })

  const base = `/api/admin/correo/casillas/${casillaId}/hilos/${encodeURIComponent(hiloId)}`

  const patch = useCallback(
    async (cambio: { leido?: boolean; carpeta?: Destino }) => {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cambio),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "No se pudo actualizar la conversación.")
      onCambioRef.current(hiloId, cambio)
      // Refresca el badge del menú sin tocar la última visita (AdminShell escucha este evento).
      window.dispatchEvent(new CustomEvent(SECTION_VISITED_EVENT, { detail: { section: "inbox" } }))
    },
    [base, hiloId],
  )

  useEffect(() => {
    let cancelado = false
    fetch(`${base}/mensajes`)
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (cancelado) return
        if (!res.ok) throw new Error(data?.error || "No se pudo cargar la conversación.")
        const h = data as CorreoHiloDetalle
        setHilo(h)
        setError(null)
        // El último mensaje se abre solo; el resto, al tocarlo (cada cuerpo es un pedido aparte).
        const ultimo = h.mensajes.at(-1)
        setAbiertos(new Set(ultimo ? [ultimo.id] : []))
        // Abrir una conversación sin leer la marca como leída.
        if (!h.leido) void patch({ leido: true }).catch(() => {})
      })
      .catch((e: unknown) => {
        if (!cancelado) setError(e instanceof Error ? e.message : "No se pudo cargar la conversación.")
      })
    return () => {
      cancelado = true
    }
    // `patch` cambia solo si cambia el hilo/casilla; el intento fuerza el reintento.
  }, [base, intento, patch])

  const mover = async (destino: Destino) => {
    setTrabajando(true)
    try {
      await patch({ carpeta: destino })
      toast({ title: destino === "trash" ? "Conversación enviada a la papelera" : "Conversación movida", tone: "success" })
      onVolver()
    } catch (e) {
      toast({ title: "No se pudo mover la conversación", description: e instanceof Error ? e.message : undefined, tone: "danger" })
    } finally {
      setTrabajando(false)
    }
  }

  const marcarNoLeido = async () => {
    setTrabajando(true)
    try {
      await patch({ leido: false })
      toast({ title: "Marcada como no leída", tone: "success" })
      onVolver()
    } catch (e) {
      toast({ title: "No se pudo marcar la conversación", description: e instanceof Error ? e.message : undefined, tone: "danger" })
    } finally {
      setTrabajando(false)
    }
  }

  const alternar = (id: string) =>
    setAbiertos((prev) => {
      const sig = new Set(prev)
      if (sig.has(id)) sig.delete(id)
      else sig.add(id)
      return sig
    })

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" onClick={onVolver} className="self-start lg:hidden"><ArrowLeft size={14} /> Volver</Button>
        <Alert tone="danger">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => { setError(null); setHilo(null); setIntento((n) => n + 1) }}>Reintentar</Button>
          </div>
        </Alert>
      </div>
    )
  }
  if (!hilo) return <Skeleton className="h-48 w-full" />

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onVolver} className="lg:hidden"><ArrowLeft size={14} /> Volver</Button>
        <h2 className="text-base font-semibold flex-1 min-w-0 break-words" style={{ color: "var(--ink)" }}>
          {hilo.asunto || "(sin asunto)"}
        </h2>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" disabled={trabajando || hilo.mensajes.length === 0} onClick={() => setRedactando("responder")}>
          <Reply size={14} /> Responder
        </Button>
        <Button size="sm" variant="outline" disabled={trabajando || hilo.mensajes.length === 0} onClick={() => setRedactando("responderATodos")}>
          <ReplyAll size={14} /> Responder a todos
        </Button>
        <Button size="sm" variant="outline" disabled={trabajando || hilo.mensajes.length === 0} onClick={() => setRedactando("reenviar")}>
          <Forward size={14} /> Reenviar
        </Button>
        {accionesDe(hilo.carpeta).map((a) => (
          <Button key={a.destino} size="sm" variant={a.destino === "trash" ? "danger" : "outline"} disabled={trabajando} onClick={() => void mover(a.destino)}>
            {a.etiqueta}
          </Button>
        ))}
        <Button size="sm" variant="outline" disabled={trabajando} onClick={() => void marcarNoLeido()}>
          Marcar como no leída
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {hilo.mensajes.map((m) => (
          <MensajeCard
            key={m.id}
            mensaje={m}
            abierto={abiertos.has(m.id)}
            onAlternar={() => alternar(m.id)}
            casillaId={casillaId}
            hiloId={hiloId}
            entrega={hilo.entregas?.[m.id]}
          />
        ))}
      </div>

      {redactando && (
        <Composer
          key={redactando}
          casilla={casilla}
          modo={redactando}
          hiloId={hiloId}
          mensaje={hilo.mensajes.at(-1)}
          onCerrar={() => setRedactando(null)}
          onEnviado={() => {
            // Resend suma el mensaje enviado al hilo: se vuelve a pedir y se refresca la lista.
            setIntento((n) => n + 1)
            onEnviado()
          }}
        />
      )}
    </div>
  )
}

function MensajeCard({
  mensaje: m,
  abierto,
  onAlternar,
  casillaId,
  hiloId,
  entrega,
}: {
  entrega?: AvisoEntrega
  mensaje: CorreoMensaje
  abierto: boolean
  onAlternar: () => void
  casillaId: string
  hiloId: string
}) {
  const aviso = m.direccion === "outbound" ? entrega : undefined
  return (
    <article className="rounded-[var(--radius)] overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <button type="button" onClick={onAlternar} aria-expanded={abierto} className="w-full text-left px-3 py-2.5 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate" style={{ color: "var(--ink)" }}>{nombreRemitente(m.de)}</span>
            <Badge tone={m.direccion === "outbound" ? "success" : "neutral"} className="text-[10px] px-1.5 py-0">
              {m.direccion === "outbound" ? "Enviado" : "Recibido"}
            </Badge>
            {m.adjuntos.length > 0 && <Paperclip size={12} aria-label="Con adjuntos" style={{ color: "var(--ink-soft)" }} />}
          </div>
          <p className="text-xs mt-0.5 break-words" style={{ color: "var(--ink-soft)" }}>
            {m.para.length > 0 && <>Para: {m.para.join(", ")}</>}
            {m.cc.length > 0 && <> · Cc: {m.cc.join(", ")}</>}
          </p>
        </div>
        <span className="text-xs shrink-0" style={{ color: "var(--ink-soft)" }}>{fechaCompletaCorreo(m.recibidoEn)}</span>
      </button>

      {aviso && (
        <div className="px-3 pb-2.5">
          <Alert tone={aviso.tono}>{aviso.texto}</Alert>
        </div>
      )}

      {abierto && (
        <div className="px-3 pb-3 flex flex-col gap-3">
          <MensajeHtml casillaId={casillaId} hiloId={hiloId} mensajeId={m.id} />
          {m.adjuntos.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="Adjuntos">
              {m.adjuntos.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                  <Paperclip size={13} aria-hidden style={{ color: "var(--ink-soft)" }} />
                  <span className="truncate flex-1 min-w-0">{a.nombre}</span>
                  <span className="text-xs shrink-0" style={{ color: "var(--ink-soft)" }}>{tamanoLegible(a.tamano)}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    href={`/api/admin/correo/adjuntos/${encodeURIComponent(m.id)}/${encodeURIComponent(a.id)}?casilla=${casillaId}&hilo=${encodeURIComponent(hiloId)}`}
                  >
                    <Download size={12} /> Descargar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  )
}
