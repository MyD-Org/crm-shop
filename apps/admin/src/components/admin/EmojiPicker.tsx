"use client"

import { useEffect, useRef, useState } from "react"
import { Smile } from "lucide-react"
import { Button } from "@myd-org/ui"

// Lista corta y elegida a mano: lo que un vendedor usa en un chat de atención. Un
// selector completo (miles de emojis, búsqueda, categorías) sería una dependencia
// pesada para un uso que cabe en una grilla.
export const EMOJIS = [
  "😊", "🙂", "😀", "😁", "😂", "😅", "😉", "😍",
  "🥰", "😘", "🤗", "🤔", "😢", "😮", "👀", "🙏",
  "👍", "👌", "👏", "🙌", "💪", "🤝", "👋", "✌️",
  "❤️", "💙", "💚", "💛", "🔥", "✨", "⭐", "🎉",
  "✅", "❌", "⚠️", "💡", "📦", "🚚", "📍", "📞",
  "💬", "🕐", "💰", "💳", "🛒", "🏠", "🎁", "🔌",
]

/**
 * Inserta `emoji` en `text` en la posición del cursor (o al final si no hay cursor) y
 * devuelve el texto nuevo y dónde queda el cursor.
 */
export function insertAt(
  text: string, emoji: string, selection?: { start: number; end: number } | null,
): { text: string; cursor: number } {
  const start = selection ? Math.min(selection.start, text.length) : text.length
  const end = selection ? Math.min(Math.max(selection.end, start), text.length) : text.length
  return { text: text.slice(0, start) + emoji + text.slice(end), cursor: start + emoji.length }
}

/**
 * Botón con una grilla de emojis para el cuadro de respuesta del inbox. El emoji va como
 * texto: WhatsApp, Instagram y Messenger lo muestran igual que si se tipeara en el celu.
 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative self-end">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Insertar emoji"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Smile size={16} strokeWidth={1.6} />
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Emojis"
          className="absolute bottom-full right-0 mb-2 z-20 grid grid-cols-8 gap-0.5 p-2 shadow-lg"
          style={{
            width: 296,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
        >
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Insertar ${emoji}`}
              onClick={() => onPick(emoji)}
              className="flex items-center justify-center text-xl leading-none transition-colors hover:bg-[var(--bg)]"
              style={{ width: 34, height: 34, borderRadius: "var(--radius-sm)" }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
