"use client"

import { Reply, X } from "lucide-react"
import type { QuotedMessageRef } from "@/lib/inbox-api"
import { quoteAuthorLabel, quoteExcerpt } from "@/lib/message-quote"

/**
 * Cita arriba de la burbuja: de quién era el mensaje citado y un extracto. Al tocarla
 * lleva al mensaje original en el hilo.
 */
export function QuoteBlock({ quote, outbound, onOpen }: {
  quote: QuotedMessageRef
  /** La burbuja que cita es saliente (fondo de color): la cita va sobre fondo claro igual. */
  outbound: boolean
  onOpen?: (messageId: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(quote.id)}
      title="Ir al mensaje citado"
      className="block w-full text-left mb-1 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs transition-opacity hover:opacity-80"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${outbound ? "var(--green)" : "var(--blue)"}`,
        color: "var(--ink-soft)",
      }}
    >
      <span className="block font-semibold text-[10px] mb-0.5" style={{ color: "var(--ink)" }}>
        {quoteAuthorLabel(quote.source)}
      </span>
      <span className="block line-clamp-2 break-words">{quoteExcerpt(quote.text)}</span>
    </button>
  )
}

/** Barra del cuadro de respuesta: a qué mensaje se está respondiendo, con forma de cancelarla. */
export function ReplyingToBar({ quote, onCancel }: { quote: QuotedMessageRef; onCancel: () => void }) {
  return (
    <div
      className="flex items-start gap-2 mb-2 px-3 py-2 rounded-[var(--radius-sm)] text-xs"
      style={{ background: "var(--card)", border: "1px solid var(--border)", borderLeft: "3px solid var(--blue)" }}
    >
      <Reply size={12} className="mt-0.5 shrink-0" style={{ color: "var(--ink-faint)" }} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[10px]" style={{ color: "var(--ink)" }}>
          Respondiendo a {quoteAuthorLabel(quote.source).toLowerCase()}
        </p>
        <p className="truncate" style={{ color: "var(--ink-soft)" }}>{quoteExcerpt(quote.text)}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancelar respuesta citada"
        title="Cancelar respuesta citada"
        className="shrink-0 p-0.5 rounded transition-colors hover:bg-[var(--bg)]"
        style={{ color: "var(--ink-faint)" }}
      >
        <X size={12} />
      </button>
    </div>
  )
}

/** Botón "Responder" de cada burbuja: aparece al pasar el mouse (siempre visible en táctil). */
export function ReplyButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Responder a este mensaje"
      title="Responder a este mensaje"
      className="self-center shrink-0 p-1 rounded-full transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 hover:bg-[var(--card)]"
      style={{ color: "var(--ink-faint)" }}
    >
      <Reply size={14} strokeWidth={1.6} />
    </button>
  )
}
