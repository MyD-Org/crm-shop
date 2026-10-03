"use client"

import { useEffect, useState } from "react"
import { Alert, Button, Skeleton } from "@myd-org/ui"
import { armarSrcdoc } from "@/lib/correo-srcdoc"

interface Props {
  casillaId: string
  hiloId: string
  mensajeId: string
}

type Estado = { tipo: "cargando" } | { tipo: "error"; mensaje: string } | { tipo: "listo"; html: string; imagenesRemotas: number }

// Cuerpo de un mensaje: se pide al abrirlo (ya saneado en el servidor) y se muestra en un iframe
// sandbox SIN scripts ni mismo origen, con CSP que bloquea las imágenes remotas hasta que la
// persona pulsa "Mostrar imágenes" (por mensaje).
export function MensajeHtml({ casillaId, hiloId, mensajeId }: Props) {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" })
  const [mostrarImagenes, setMostrarImagenes] = useState(false)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let cancelado = false
    const url = `/api/admin/correo/casillas/${casillaId}/hilos/${encodeURIComponent(hiloId)}/mensajes/${encodeURIComponent(mensajeId)}`
    fetch(url)
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (cancelado) return
        if (!res.ok) throw new Error(data?.error || "No se pudo cargar el mensaje.")
        setEstado({ tipo: "listo", html: String(data.html ?? ""), imagenesRemotas: Number(data.imagenesRemotas) || 0 })
      })
      .catch((e: unknown) => {
        if (!cancelado) setEstado({ tipo: "error", mensaje: e instanceof Error ? e.message : "No se pudo cargar el mensaje." })
      })
    return () => {
      cancelado = true
    }
  }, [casillaId, hiloId, mensajeId, intento])

  if (estado.tipo === "cargando") return <Skeleton className="h-24 w-full" />
  if (estado.tipo === "error") {
    return (
      <Alert tone="danger">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span>{estado.mensaje}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEstado({ tipo: "cargando" })
              setIntento((n) => n + 1)
            }}
          >
            Reintentar
          </Button>
        </div>
      </Alert>
    )
  }
  if (!estado.html) return <p className="text-sm" style={{ color: "var(--ink-soft)" }}>Este mensaje no tiene contenido.</p>

  return (
    <div className="flex flex-col gap-2">
      {estado.imagenesRemotas > 0 && !mostrarImagenes && (
        <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: "var(--ink-soft)" }}>
          <span>Se bloquearon las imágenes remotas de este mensaje.</span>
          <Button size="sm" variant="outline" onClick={() => setMostrarImagenes(true)}>
            Mostrar imágenes
          </Button>
        </div>
      )}
      <iframe
        title="Contenido del mensaje"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={armarSrcdoc(estado.html, mostrarImagenes)}
        className="w-full rounded-[var(--radius)]"
        style={{ height: 420, border: "1px solid var(--border)", background: "#fff" }}
      />
    </div>
  )
}
