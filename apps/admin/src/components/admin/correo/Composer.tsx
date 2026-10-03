"use client"

import { useEffect, useRef, useState } from "react"
import { Paperclip, X } from "lucide-react"
import { Alert, Button, Checkbox, Dialog, Field, FileDropZone, Input, Progress, Textarea, useToast } from "@myd-org/ui"
import {
  asuntoReenviar,
  asuntoResponder,
  destinatariosPorDefecto,
  type MensajeOriginal,
  type ModoEnvio,
} from "@/lib/correo-compose"
import {
  crearClavesIdempotencia,
  crearEnvioUnico,
  enviarCorreo,
  parseDestinatarios,
  validarAdjuntoCliente,
} from "@/lib/correo-envio-cliente"
import { tamanoLegible } from "@/lib/correo-formato"
import { sugerirCorreccion } from "@/lib/correo-validacion"
import type { CorreoMensaje } from "@/lib/correo-resend"

interface AdjuntoUI {
  id: string
  nombre: string
  tamano: number
  estado: "subiendo" | "listo" | "error"
  progreso: number
  key?: string
  error?: string
}

interface Props {
  casilla: { id: string; nombre: string; email: string }
  modo: ModoEnvio
  /** Mensaje que se responde o reenvía (no aplica a "nuevo"). */
  mensaje?: CorreoMensaje
  hiloId?: string
  onCerrar: () => void
  /** Se envió con éxito: el padre revalida el hilo / la lista. */
  onEnviado: () => void
}

const TITULOS: Record<ModoEnvio, string> = {
  responder: "Responder",
  responderATodos: "Responder a todos",
  reenviar: "Reenviar",
  nuevo: "Redactar mensaje",
}

function originalDe(m: CorreoMensaje): MensajeOriginal {
  return {
    direccion: m.direccion,
    de: m.de,
    para: m.para,
    cc: m.cc,
    replyTo: m.replyTo,
    asunto: m.asunto,
    messageId: m.messageId,
    recibidoEn: m.recibidoEn,
  }
}

/** PUT directo a R2 con progreso (fetch no informa el avance de la subida). */
function subirAR2(url: string, headers: Record<string, string>, archivo: File, onProgreso: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgreso(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`R2 ${xhr.status}`)))
    xhr.onerror = () => reject(new Error("red"))
    xhr.send(archivo)
  })
}

// Compositor del correo (Dialog): responder, responder a todos, reenviar y redactar. Texto plano
// (el servidor lo convierte a html escapado). Los adjuntos se suben directo a R2 apenas se
// eligen; el envío usa solo las keys. Un error NUNCA vacía el borrador ni los adjuntos.
export function Composer({ casilla, modo, mensaje, hiloId, onCerrar, onEnviado }: Props) {
  const { toast } = useToast()
  const original = mensaje ? originalDe(mensaje) : undefined
  const [inicial] = useState(() => destinatariosPorDefecto(modo, original, casilla.email))
  const [para, setPara] = useState(inicial.para.join(", "))
  const [cc, setCc] = useState(inicial.cc.join(", "))
  const [cco, setCco] = useState("")
  const [asunto, setAsunto] = useState(() =>
    modo === "responder" || modo === "responderATodos"
      ? asuntoResponder(mensaje?.asunto ?? "")
      : modo === "reenviar"
        ? asuntoReenviar(mensaje?.asunto ?? "")
        : "",
  )
  const [texto, setTexto] = useState("")
  const [adjuntos, setAdjuntos] = useState<AdjuntoUI[]>([])
  const [reenviarAdjuntos, setReenviarAdjuntos] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Problema de las direcciones (typo o dominio sin correo): se muestra junto a los campos.
  const [errorDestinatario, setErrorDestinatario] = useState<{ mensaje: string; sugerencia: string | null } | null>(null)
  const [confirmarSinAsunto, setConfirmarSinAsunto] = useState(false)
  const [claves] = useState(() => crearClavesIdempotencia())

  const subiendo = adjuntos.some((a) => a.estado === "subiendo")
  const hayDestinatario = parseDestinatarios(para).length > 0
  const conAdjuntosOriginales = modo === "reenviar" && (mensaje?.adjuntos.length ?? 0) > 0

  const actualizar = (id: string, cambio: Partial<AdjuntoUI>) =>
    setAdjuntos((prev) => prev.map((a) => (a.id === id ? { ...a, ...cambio } : a)))

  const agregarArchivo = async (archivo: File | null) => {
    if (!archivo) return
    const problema = validarAdjuntoCliente(
      archivo,
      adjuntos.filter((a) => a.estado !== "error").map((a) => a.tamano),
    )
    if (problema) {
      setError(problema)
      return
    }
    setError(null)
    const id = crypto.randomUUID()
    setAdjuntos((prev) => [...prev, { id, nombre: archivo.name, tamano: archivo.size, estado: "subiendo", progreso: 0 }])
    try {
      const res = await fetch("/api/admin/correo/adjuntos/subida", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ casillaId: casilla.id, nombre: archivo.name, tamano: archivo.size, tipo: archivo.type || "application/octet-stream" }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "No se pudo preparar el archivo.")
      await subirAR2(data.putUrl, data.headers ?? {}, archivo, (p) => actualizar(id, { progreso: p }))
      actualizar(id, { estado: "listo", progreso: 100, key: data.key })
    } catch (e) {
      actualizar(id, { estado: "error", error: e instanceof Error && e.message !== "red" && !e.message.startsWith("R2 ") ? e.message : "No se pudo subir el archivo. Inténtelo nuevamente." })
    }
  }

  const ejecutar = async () => {
    setEnviando(true)
    setError(null)
    setErrorDestinatario(null)
    const cuerpo = {
      casillaId: casilla.id,
      modo,
      hiloId,
      mensajeId: mensaje?.id,
      para: parseDestinatarios(para),
      cc: parseDestinatarios(cc),
      cco: parseDestinatarios(cco),
      asunto,
      texto,
      adjuntos: adjuntos.filter((a) => a.estado === "listo" && a.key).map((a) => ({ key: a.key, nombre: a.nombre })),
      reenviarAdjuntos: conAdjuntosOriginales && reenviarAdjuntos,
    }
    const r = await enviarCorreo(fetch, { ...cuerpo, claveIdempotencia: claves(JSON.stringify(cuerpo)) })
    setEnviando(false)
    if (!r.ok) {
      if (r.destinatario) setErrorDestinatario({ mensaje: r.error, sugerencia: r.sugerencia ?? null })
      else setError(r.error)
      return
    }
    claves.reiniciar()
    toast({ title: "Mensaje enviado", tone: "success" })
    if (r.aviso) toast({ title: r.aviso, tone: "warning" })
    onEnviado()
    onCerrar()
  }

  // El envío único vive en el estado y llama siempre a la última versión de `ejecutar`.
  const ejecutarRef = useRef(ejecutar)
  useEffect(() => {
    ejecutarRef.current = ejecutar
  })
  const enviarUnicoRef = useRef<(() => Promise<void>) | null>(null)

  // Reemplaza en Para/CC/CCO las direcciones cuyo dominio tiene la corrección sugerida.
  const aplicarSugerencia = (sugerencia: string) => {
    const corregir = (texto: string) =>
      parseDestinatarios(texto).map((d) => (sugerirCorreccion(d) === sugerencia ? sugerencia : d)).join(", ")
    setPara(corregir)
    setCc(corregir)
    setCco(corregir)
    setErrorDestinatario(null)
  }

  const intentarEnviar = () => {
    if (enviando || subiendo || !hayDestinatario) return
    if (!asunto.trim() && !confirmarSinAsunto) {
      setConfirmarSinAsunto(true)
      return
    }
    setConfirmarSinAsunto(false)
    enviarUnicoRef.current ??= crearEnvioUnico(() => ejecutarRef.current())
    void enviarUnicoRef.current()
  }

  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto && !enviando) onCerrar()
      }}
      title={TITULOS[modo]}
      description={`Se enviará desde ${casilla.nombre} (${casilla.email}).`}
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <Button variant="ghost" onClick={onCerrar} disabled={enviando}>Cancelar</Button>
          <Button onClick={intentarEnviar} loading={enviando} disabled={enviando || subiendo || !hayDestinatario}>
            Enviar
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {confirmarSinAsunto && (
          <Alert tone="warning">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span>¿Enviar sin asunto?</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirmarSinAsunto(false)}>Volver</Button>
                <Button size="sm" onClick={intentarEnviar}>Enviar sin asunto</Button>
              </div>
            </div>
          </Alert>
        )}

        <Field label="Para" hint="Separe las direcciones con coma." error={errorDestinatario?.mensaje}>
          <Input
            value={para}
            onChange={(e) => {
              setPara(e.target.value)
              setErrorDestinatario(null)
            }}
            disabled={enviando}
            autoComplete="off"
          />
        </Field>
        {errorDestinatario?.sugerencia && (
          <div>
            <Button size="sm" variant="outline" onClick={() => aplicarSugerencia(errorDestinatario.sugerencia!)}>
              Usar {errorDestinatario.sugerencia}
            </Button>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="CC">
            <Input value={cc} onChange={(e) => setCc(e.target.value)} disabled={enviando} autoComplete="off" />
          </Field>
          <Field label="CCO">
            <Input value={cco} onChange={(e) => setCco(e.target.value)} disabled={enviando} autoComplete="off" />
          </Field>
        </div>
        <Field label="Asunto">
          <Input value={asunto} onChange={(e) => setAsunto(e.target.value)} disabled={enviando} />
        </Field>
        <Field label="Mensaje">
          <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} disabled={enviando} rows={9} />
        </Field>

        {conAdjuntosOriginales && (
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--ink)" }}>
            <Checkbox checked={reenviarAdjuntos} onCheckedChange={setReenviarAdjuntos} disabled={enviando} />
            <span>Incluir los {mensaje?.adjuntos.length} adjuntos del mensaje original</span>
          </label>
        )}

        {adjuntos.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Adjuntos del mensaje">
            {adjuntos.map((a) => (
              <li key={a.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
                  <Paperclip size={13} aria-hidden style={{ color: "var(--ink-soft)" }} />
                  <span className="truncate flex-1 min-w-0">{a.nombre}</span>
                  <span className="text-xs shrink-0" style={{ color: "var(--ink-soft)" }}>{tamanoLegible(a.tamano)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Quitar ${a.nombre}`}
                    disabled={enviando}
                    onClick={() => setAdjuntos((prev) => prev.filter((x) => x.id !== a.id))}
                  >
                    <X size={12} />
                  </Button>
                </div>
                {a.estado === "subiendo" && <Progress value={a.progreso} size="sm" aria-label={`Subiendo ${a.nombre}`} />}
                {a.estado === "error" && <span className="text-xs" style={{ color: "var(--red)" }}>{a.error}</span>}
              </li>
            ))}
          </ul>
        )}

        <FileDropZone
          file={null}
          onChange={(f) => void agregarArchivo(f)}
          disabled={enviando}
          size="sm"
          title="Adjuntar un archivo"
          hint="Hasta 40 MB en total por mensaje."
          browseLabel="selecciónelo desde su equipo"
        />
      </div>
    </Dialog>
  )
}
