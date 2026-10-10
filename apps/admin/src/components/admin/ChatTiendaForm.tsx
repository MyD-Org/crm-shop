"use client"

import { useState } from "react"
import { Button, Field, Input, useToast } from "@myd-org/ui"
import { useUnsavedGuard } from "@/lib/unsaved-guard"
import { CHAT_VACIO_MAX, SUGERENCIA_MAX, SUGERENCIAS_MAX } from "@/lib/chat-tienda"

interface Props {
  initialEmptyState: string
  initialSuggestions: string[]
}

// Placeholders = los textos que el Shop muestra cuando el campo queda vacío
// (apps/clientes/src/lib/chat-ia-textos.ts). Sólo orientan: no se guardan.
const VACIO_POR_DEFECTO = "Consultas sobre productos, precios y pedidos"
const SUGERENCIAS_POR_DEFECTO = ["¿Qué lámpara conviene para un living?", "Reflectores para exterior", "Estado de un pedido", ""]

const completar = (s: string[]) => Array.from({ length: SUGERENCIAS_MAX }, (_, i) => s[i] ?? "")

// Datos → Chat de la tienda: texto del chat vacío y preguntas sugeridas del asistente del Shop
// (`tenants.chat_empty_state` / `chat_suggestions`, GET/PUT /api/admin/settings/chat-tienda).
export function ChatTiendaForm({ initialEmptyState, initialSuggestions }: Props) {
  const [emptyState, setEmptyState] = useState(initialEmptyState)
  const [suggestions, setSuggestions] = useState(() => completar(initialSuggestions))
  const [guardado, setGuardado] = useState(() => JSON.stringify([initialEmptyState, completar(initialSuggestions)]))
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useUnsavedGuard(JSON.stringify([emptyState, suggestions]) !== guardado)

  function cambiarSugerencia(i: number, valor: string) {
    setSuggestions((prev) => prev.map((s, j) => (j === i ? valor : s)))
  }

  async function handleSave() {
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/admin/settings/chat-tienda", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emptyState, suggestions }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? "No se pudieron guardar los textos. Inténtelo nuevamente.")
        return
      }
      const nuevas = completar(body.suggestions ?? [])
      setEmptyState(body.emptyState ?? "")
      setSuggestions(nuevas)
      setGuardado(JSON.stringify([body.emptyState ?? "", nuevas]))
      toast({ title: "Textos guardados", tone: "success" })
    } catch {
      setError("Error de conexión. Inténtelo nuevamente.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-xl">
      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
        Escriba los textos en forma impersonal o en infinitivo (por ejemplo, «Consultas sobre productos» o «Ver el estado
        de un pedido»), sin «usted» ni «vos»: el chat de la tienda usa ese registro. Si deja un campo vacío, la tienda
        muestra el texto de ejemplo.
      </p>
      <Field
        label="Texto del chat vacío"
        hint={`Se muestra al abrir el chat, antes del primer mensaje. Hasta ${CHAT_VACIO_MAX} caracteres.`}
      >
        <Input
          value={emptyState}
          maxLength={CHAT_VACIO_MAX}
          placeholder={VACIO_POR_DEFECTO}
          onChange={(e) => setEmptyState(e.target.value)}
        />
      </Field>
      <Field
        label="Preguntas sugeridas"
        hint={`Hasta ${SUGERENCIAS_MAX}, de ${SUGERENCIA_MAX} caracteres como máximo. Al tocar una, se envía como mensaje. Si las deja todas vacías, la tienda muestra las de ejemplo.`}
      >
        <div className="flex flex-col gap-2">
          {suggestions.map((s, i) => (
            <Input
              key={i}
              value={s}
              maxLength={SUGERENCIA_MAX}
              placeholder={SUGERENCIAS_POR_DEFECTO[i] || "Pregunta opcional"}
              aria-label={`Pregunta sugerida ${i + 1}`}
              onChange={(e) => cambiarSugerencia(i, e.target.value)}
            />
          ))}
        </div>
      </Field>
      {error && <p className="text-sm" style={{ color: "var(--red)" }}>{error}</p>}
      <div>
        <Button onClick={handleSave} loading={saving} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  )
}
