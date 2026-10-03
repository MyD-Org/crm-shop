"use client"

import { Paperclip } from "lucide-react"
import { Badge } from "@myd-org/ui"
import type { CorreoHilo } from "@/lib/correo-resend"
import { fechaCorreo, nombreRemitente } from "@/lib/correo-formato"

interface Props {
  hilos: CorreoHilo[]
  seleccionado: string | null
  onSeleccionar: (hilo: CorreoHilo) => void
}

export function HiloList({ hilos, seleccionado, onSeleccionar }: Props) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Conversaciones de correo">
      {hilos.map((h) => {
        const activo = h.id === seleccionado
        return (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => onSeleccionar(h)}
              aria-current={activo ? "true" : undefined}
              className="w-full text-left flex items-start gap-3 px-3 py-3 rounded-[var(--radius)] transition-colors hover:opacity-90"
              style={{
                background: activo ? "var(--blue-soft)" : "var(--card)",
                border: `1px solid ${activo ? "var(--blue)" : "var(--border)"}`,
                borderLeft: `3px solid ${h.leido ? "transparent" : "var(--blue)"}`,
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm truncate flex-1 ${h.leido ? "" : "font-semibold"}`} style={{ color: "var(--ink)" }}>
                    {nombreRemitente(h.de) || "(sin remitente)"}
                  </span>
                  <span className="text-xs shrink-0" style={{ color: "var(--ink-soft)" }}>{fechaCorreo(h.recibidoEn)}</span>
                </div>
                <p className={`text-sm truncate ${h.leido ? "" : "font-medium"}`} style={{ color: "var(--ink)" }}>
                  {h.asunto || "(sin asunto)"}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  {!h.leido && <Badge tone="info" className="text-[10px] px-1.5 py-0">Sin leer</Badge>}
                  {h.mensajes > 1 && <span className="text-xs" style={{ color: "var(--ink-soft)" }}>{h.mensajes} mensajes</span>}
                  {h.conAdjuntos && (
                    <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--ink-soft)" }}>
                      <Paperclip size={11} aria-hidden /> Adjunto
                    </span>
                  )}
                </div>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
